/* -*- Mode: C++; tab-width: 20; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/layers/AsyncTransactionTracker.h" // for AsyncTransactionTracker
#include "mozilla/layers/CompositorChild.h"
#include "mozilla/layers/CompositorParent.h"
#include "mozilla/layers/ImageBridgeChild.h"
#include "mozilla/layers/SharedBufferManagerChild.h"
#include "mozilla/layers/ISurfaceAllocator.h"     // for GfxMemoryImageReporter
#include "mozilla/Telemetry.h"

#include "mozilla/Logging.h"
#include "mozilla/Services.h"
#include "prprf.h"

#include "gfxPlatform.h"
#include "gfxPrefs.h"
#include "gfxEnv.h"
#include "gfxTextRun.h"
#include "gfxVR.h"

#ifdef XP_WIN
#include <process.h>
#define getpid _getpid
#else
#include <unistd.h>
#endif

#include "nsXULAppAPI.h"
#include "nsDirectoryServiceUtils.h"
#include "nsDirectoryServiceDefs.h"

#if defined(XP_WIN)
#include "gfxWindowsPlatform.h"
#elif defined(XP_MACOSX)
#include "gfxPlatformMac.h"
#include "gfxQuartzSurface.h"
#elif defined(MOZ_WIDGET_GTK)
#include "gfxPlatformGtk.h"
#elif defined(MOZ_WIDGET_QT)
#include "gfxQtPlatform.h"
#elif defined(ANDROID)
#include "gfxAndroidPlatform.h"
#endif

#include "nsGkAtoms.h"
#include "gfxPlatformFontList.h"
#include "gfxContext.h"
#include "gfxImageSurface.h"
#include "nsUnicodeProperties.h"
#include "harfbuzz/hb.h"
#include "gfxGraphiteShaper.h"
#include "gfx2DGlue.h"
#include "gfxGradientCache.h"
#include "gfxUtils.h" // for NextPowerOfTwo

#include "nsUnicodeRange.h"
#include "nsServiceManagerUtils.h"
#include "nsTArray.h"
#include "nsILocaleService.h"
#include "nsIObserverService.h"
#include "nsIScreenManager.h"
#include "MainThreadUtils.h"
#ifdef MOZ_CRASHREPORTER
#include "nsExceptionHandler.h"
#endif

#include "nsWeakReference.h"

#include "cairo.h"
#include "qcms.h"

#include "imgITools.h"

#include "plstr.h"
#include "nsCRT.h"
#include "GLContext.h"
#include "GLContextProvider.h"
#include "mozilla/gfx/Logging.h"

#if defined(MOZ_WIDGET_GTK)
#include "gfxPlatformGtk.h" // xxx - for UseFcFontList
#endif

#ifdef MOZ_WIDGET_ANDROID
#include "TexturePoolOGL.h"
#endif

#ifdef MOZ_WIDGET_GONK
#include "mozilla/layers/GrallocTextureHost.h"
#endif

#include "mozilla/Hal.h"

#ifdef USE_SKIA
# ifdef __GNUC__
#  pragma GCC diagnostic push
#  pragma GCC diagnostic ignored "-Wshadow"
# endif
# include "skia/include/core/SkGraphics.h"
# ifdef USE_SKIA_GPU
#  include "skia/include/gpu/GrContext.h"
#  include "skia/include/gpu/gl/GrGLInterface.h"
#  include "SkiaGLGlue.h"
# endif
# ifdef __GNUC__
#  pragma GCC diagnostic pop // -Wshadow
# endif
#endif

#if !defined(USE_SKIA) || !defined(USE_SKIA_GPU)
class mozilla::gl::SkiaGLGlue : public GenericAtomicRefCounted {
};
#endif

#include "mozilla/Preferences.h"
#include "mozilla/Assertions.h"
#include "mozilla/Attributes.h"
#include "mozilla/Mutex.h"

#include "nsIGfxInfo.h"
#include "nsIXULRuntime.h"
#include "VsyncSource.h"
#include "SoftwareVsyncSource.h"
#include "nscore.h" // for NS_FREE_PERMANENT_DATA
#include "mozilla/dom/ContentChild.h"

namespace mozilla {
namespace layers {
#ifdef MOZ_WIDGET_GONK
void InitGralloc();
#endif
void ShutdownTileCache();
} // namespace layers
} // namespace mozilla

using namespace mozilla;
using namespace mozilla::layers;
using namespace mozilla::gl;

gfxPlatform *gPlatform = nullptr;
static bool gEverInitialized = false;

static Mutex* gGfxPlatformPrefsLock = nullptr;

// These two may point to the same profile
static qcms_profile *gCMSOutputProfile = nullptr;
static qcms_profile *gCMSsRGBProfile = nullptr;

static bool gCMSRGBTransformFailed = false;
static qcms_transform *gCMSRGBTransform = nullptr;
static qcms_transform *gCMSInverseRGBTransform = nullptr;
static qcms_transform *gCMSRGBATransform = nullptr;

static bool gCMSInitialized = false;
static eCMSMode gCMSMode = eCMSMode_Off;

static void ShutdownCMS();

#include "mozilla/gfx/2D.h"
#include "mozilla/gfx/SourceSurfaceCairo.h"
using namespace mozilla::gfx;

void InitLayersAccelerationPrefs();

/* Class to listen for pref changes so that chrome code can dynamically
   force sRGB as an output profile. See Bug #452125. */
class SRGBOverrideObserver final : public nsIObserver,
                                   public nsSupportsWeakReference
{
    ~SRGBOverrideObserver() {}
public:
    NS_DECL_ISUPPORTS
    NS_DECL_NSIOBSERVER
};

/// This override of the LogForwarder, initially used for the critical graphics
/// errors, is sending the log to the crash annotations as well, but only
/// if the capacity set with the method below is >= 2.  We always retain the
/// very first critical message, and the latest capacity-1 messages are
/// rotated through. Note that we don't expect the total number of times
/// this gets called to be large - it is meant for critical errors only.

class CrashStatsLogForwarder: public mozilla::gfx::LogForwarder
{
public:
  explicit CrashStatsLogForwarder(const char* aKey);
  virtual void Log(const std::string& aString) override;
  virtual void CrashAction(LogReason aReason) override;

  virtual std::vector<std::pair<int32_t,std::string> > StringsVectorCopy() override;

  void SetCircularBufferSize(uint32_t aCapacity);

private:
  // Helpers for the Log()
  bool UpdateStringsVector(const std::string& aString);
  void UpdateCrashReport();

private:
  std::vector<std::pair<int32_t,std::string> > mBuffer;
  nsCString mCrashCriticalKey;
  uint32_t mMaxCapacity;
  int32_t mIndex;
  Mutex mMutex;
};

CrashStatsLogForwarder::CrashStatsLogForwarder(const char* aKey)
  : mBuffer()
  , mCrashCriticalKey(aKey)
  , mMaxCapacity(0)
  , mIndex(-1)
  , mMutex("CrashStatsLogForwarder")
{
}

void CrashStatsLogForwarder::SetCircularBufferSize(uint32_t aCapacity)
{
  MutexAutoLock lock(mMutex);

  mMaxCapacity = aCapacity;
  mBuffer.reserve(static_cast<size_t>(aCapacity));
}

std::vector<std::pair<int32_t,std::string> >
CrashStatsLogForwarder::StringsVectorCopy()
{
  MutexAutoLock lock(mMutex);
  return mBuffer;
}

bool
CrashStatsLogForwarder::UpdateStringsVector(const std::string& aString)
{
  // We want at least the first one and the last one.  Otherwise, no point.
  if (mMaxCapacity < 2) {
    return false;
  }

  mIndex += 1;
  MOZ_ASSERT(mIndex >= 0);

  // index will count 0, 1, 2, ..., max-1, 1, 2, ..., max-1, 1, 2, ...
  int32_t index = mIndex ? (mIndex-1) % (mMaxCapacity-1) + 1 : 0;
  MOZ_ASSERT(index >= 0 && index < (int32_t)mMaxCapacity);
  MOZ_ASSERT(index <= mIndex && index <= (int32_t)mBuffer.size());

  // Checking for index >= mBuffer.size(), rather than index == mBuffer.size()
  // just out of paranoia, but we know index <= mBuffer.size().
  std::pair<int32_t,std::string> newEntry(mIndex,aString);
  if (index >= static_cast<int32_t>(mBuffer.size())) {
    mBuffer.push_back(newEntry);
  } else {
    mBuffer[index] = newEntry;
  }
  return true;
}

void CrashStatsLogForwarder::UpdateCrashReport()
{
  std::stringstream message;
  for(std::vector<std::pair<int32_t, std::string> >::iterator it = mBuffer.begin(); it != mBuffer.end(); ++it) {
    message << "|[" << (*it).first << "]" << (*it).second;
  }

#ifdef MOZ_CRASHREPORTER
  nsCString reportString(message.str().c_str());
  nsresult annotated = CrashReporter::AnnotateCrashReport(mCrashCriticalKey, reportString);
#else
  nsresult annotated = NS_ERROR_NOT_IMPLEMENTED;
#endif
  if (annotated != NS_OK) {
    printf("Crash Annotation %s: %s",
           mCrashCriticalKey.get(), message.str().c_str());
  }
}

void CrashStatsLogForwarder::Log(const std::string& aString)
{
  MutexAutoLock lock(mMutex);

  if (UpdateStringsVector(aString)) {
    UpdateCrashReport();
  }
}

class CrashTelemetryEvent : public nsRunnable
{
  virtual ~CrashTelemetryEvent() {}

  NS_DECL_ISUPPORTS_INHERITED

  explicit CrashTelemetryEvent(uint32_t aReason) : mReason(aReason) {}

  NS_IMETHOD Run() override {
    MOZ_ASSERT(NS_IsMainThread());
    Telemetry::Accumulate(Telemetry::GFX_CRASH, mReason);
    return NS_OK;
  }

protected:
  uint32_t mReason;
};

NS_IMPL_ISUPPORTS_INHERITED0(CrashTelemetryEvent, nsRunnable);

void
CrashStatsLogForwarder::CrashAction(LogReason aReason)
{
#ifndef RELEASE_BUILD
  // Non-release builds crash by default, but will use telemetry
  // if this environment variable is present.
  static bool useTelemetry = gfxEnv::GfxDevCrashTelemetry();
#else
  // Release builds use telemetry by default, but will crash instead
  // if this environment variable is present.
  static bool useTelemetry = !gfxEnv::GfxDevCrashMozCrash();
#endif

  if (useTelemetry) {
    // The callers need to assure that aReason is in the range
    // that the telemetry call below supports.
    if (NS_IsMainThread()) {
      Telemetry::Accumulate(Telemetry::GFX_CRASH, (uint32_t)aReason);
    } else {
      nsCOMPtr<nsIRunnable> r1 = new CrashTelemetryEvent((uint32_t)aReason);
      NS_DispatchToMainThread(r1);
    }
  } else {
    // ignoring aReason, we can get the information we need from the stack
    MOZ_CRASH("GFX_CRASH");
  }
}

NS_IMPL_ISUPPORTS(SRGBOverrideObserver, nsIObserver, nsISupportsWeakReference)

#define GFX_DOWNLOADABLE_FONTS_ENABLED "gfx.downloadable_fonts.enabled"

#define GFX_PREF_FALLBACK_USE_CMAPS  "gfx.font_rendering.fallback.always_use_cmaps"

#define GFX_PREF_OPENTYPE_SVG "gfx.font_rendering.opentype_svg.enabled"

#define GFX_PREF_WORD_CACHE_CHARLIMIT "gfx.font_rendering.wordcache.charlimit"
#define GFX_PREF_WORD_CACHE_MAXENTRIES "gfx.font_rendering.wordcache.maxentries"

#define GFX_PREF_GRAPHITE_SHAPING "gfx.font_rendering.graphite.enabled"

#define BIDI_NUMERAL_PREF "bidi.numeral"

#define GFX_PREF_CMS_FORCE_SRGB "gfx.color_management.force_srgb"

NS_IMETHODIMP
SRGBOverrideObserver::Observe(nsISupports *aSubject,
                              const char *aTopic,
                              const char16_t* someData)
{
    NS_ASSERTION(NS_strcmp(someData,
                           MOZ_UTF16(GFX_PREF_CMS_FORCE_SRGB)) == 0,
                 "Restarting CMS on wrong pref!");
    ShutdownCMS();
    // Update current cms profile.
    gfxPlatform::CreateCMSOutputProfile();
    return NS_OK;
}

static const char* kObservedPrefs[] = {
    "gfx.downloadable_fonts.",
    "gfx.font_rendering.",
    BIDI_NUMERAL_PREF,
    nullptr
};

class FontPrefsObserver final : public nsIObserver
{
    ~FontPrefsObserver() {}
public:
    NS_DECL_ISUPPORTS
    NS_DECL_NSIOBSERVER
};

NS_IMPL_ISUPPORTS(FontPrefsObserver, nsIObserver)

NS_IMETHODIMP
FontPrefsObserver::Observe(nsISupports *aSubject,
                           const char *aTopic,
                           const char16_t *someData)
{
    if (!someData) {
        NS_ERROR("font pref observer code broken");
        return NS_ERROR_UNEXPECTED;
    }
    NS_ASSERTION(gfxPlatform::GetPlatform(), "the singleton instance has gone");
    gfxPlatform::GetPlatform()->FontsPrefsChanged(NS_ConvertUTF16toUTF8(someData).get());

    return NS_OK;
}

class MemoryPressureObserver final : public nsIObserver
{
    ~MemoryPressureObserver() {}
public:
    NS_DECL_ISUPPORTS
    NS_DECL_NSIOBSERVER
};

NS_IMPL_ISUPPORTS(MemoryPressureObserver, nsIObserver)

NS_IMETHODIMP
MemoryPressureObserver::Observe(nsISupports *aSubject,
                                const char *aTopic,
                                const char16_t *someData)
{
    NS_ASSERTION(strcmp(aTopic, "memory-pressure") == 0, "unexpected event topic");
    Factory::PurgeAllCaches();
    gfxGradientCache::PurgeAllCaches();

    gfxPlatform::GetPlatform()->PurgeSkiaCache();
    return NS_OK;
}

gfxPlatform::gfxPlatform()
  : mTileWidth(-1)
  , mTileHeight(-1)
  , mAzureCanvasBackendCollector(this, &gfxPlatform::GetAzureBackendInfo)
  , mApzSupportCollector(this, &gfxPlatform::GetApzSupportInfo)
  , mCompositorBackend(layers::LayersBackend::LAYERS_NONE)
  , mScreenDepth(0)
{
    mAllowDownloadableFonts = UNINITIALIZED_VALUE;
    mFallbackUsesCmaps = UNINITIALIZED_VALUE;

    mWordCacheCharLimit = UNINITIALIZED_VALUE;
    mWordCacheMaxEntries = UNINITIALIZED_VALUE;
    mGraphiteShapingEnabled = UNINITIALIZED_VALUE;
    mOpenTypeSVGEnabled = UNINITIALIZED_VALUE;
    mBidiNumeralOption = UNINITIALIZED_VALUE;

    mSkiaGlue = nullptr;

    uint32_t canvasMask = BackendTypeBit(BackendType::CAIRO) | BackendTypeBit(BackendType::SKIA);
    uint32_t contentMask = BackendTypeBit(BackendType::CAIRO);
    InitBackendPrefs(canvasMask, BackendType::CAIRO,
                     contentMask, BackendType::CAIRO);
    mTotalSystemMemory = mozilla::hal::GetTotalSystemMemory();

    // give HMDs a chance to be initialized very early on
    VRHMDManager::ManagerInit();
}

gfxPlatform*
gfxPlatform::GetPlatform()
{
    if (!gPlatform) {
        Init();
    }
    return gPlatform;
}

bool
gfxPlatform::Initialized()
{
  return !!gPlatform;
}

void RecordingPrefChanged(const char *aPrefName, void *aClosure)
{
  if (Preferences::GetBool("gfx.2d.recording", false)) {
    nsAutoCString fileName;
    nsAdoptingString prefFileName = Preferences::GetString("gfx.2d.recordingfile");

    if (prefFileName) {
      fileName.Append(NS_ConvertUTF16toUTF8(prefFileName));
    } else {
      nsCOMPtr<nsIFile> tmpFile;
      if (NS_FAILED(NS_GetSpecialDirectory(NS_OS_TEMP_DIR, getter_AddRefs(tmpFile)))) {
        return;
      }
      fileName.AppendPrintf("moz2drec_%i_%i.aer", XRE_GetProcessType(), getpid());

      nsresult rv = tmpFile->AppendNative(fileName);
      if (NS_FAILED(rv))
        return;

      rv = tmpFile->GetNativePath(fileName);
      if (NS_FAILED(rv))
        return;
    }

    gPlatform->mRecorder = Factory::CreateEventRecorderForFile(fileName.BeginReading());
    printf_stderr("Recording to %s\n", fileName.get());
    Factory::SetGlobalEventRecorder(gPlatform->mRecorder);
  } else {
    Factory::SetGlobalEventRecorder(nullptr);
  }
}

void
gfxPlatform::Init()
{
    MOZ_RELEASE_ASSERT(NS_IsMainThread());
    if (gEverInitialized) {
        NS_RUNTIMEABORT("Already started???");
    }
    gEverInitialized = true;

    // Initialize the preferences by creating the singleton.
    gfxPrefs::GetSingleton();

    auto fwd = new CrashStatsLogForwarder("GraphicsCriticalError");
    fwd->SetCircularBufferSize(gfxPrefs::GfxLoggingCrashLength());

    mozilla::gfx::Config cfg;
    cfg.mLogForwarder = fwd;
    cfg.mMaxTextureSize = gfxPrefs::MaxTextureSize();
    cfg.mMaxAllocSize = gfxPrefs::MaxAllocSize();

    gfx::Factory::Init(cfg);

    gGfxPlatformPrefsLock = new Mutex("gfxPlatform::gGfxPlatformPrefsLock");

    /* Initialize the GfxInfo service.
     * Note: we can't call functions on GfxInfo that depend
     * on gPlatform until after it has been initialized
     * below. GfxInfo initialization annotates our
     * crash reports so we want to do it before
     * we try to load any drivers and do device detection
     * incase that code crashes. See bug #591561. */
    nsCOMPtr<nsIGfxInfo> gfxInfo;
    /* this currently will only succeed on Windows */
    gfxInfo = services::GetGfxInfo();

#if defined(XP_WIN)
    gPlatform = new gfxWindowsPlatform;
#elif defined(XP_MACOSX)
    gPlatform = new gfxPlatformMac;
#elif defined(MOZ_WIDGET_GTK)
    gPlatform = new gfxPlatformGtk;
#elif defined(MOZ_WIDGET_QT)
    gPlatform = new gfxQtPlatform;
#elif defined(ANDROID)
    gPlatform = new gfxAndroidPlatform;
#else
    #error "No gfxPlatform implementation available"
#endif

#ifdef USE_SKIA
    SkGraphics::Init();
#endif

#ifdef MOZ_GL_DEBUG
    GLContext::StaticInit();
#endif

    InitLayersAccelerationPrefs();
    InitLayersIPC();

    gPlatform->PopulateScreenInfo();
    gPlatform->ComputeTileSize();

    nsresult rv;

    bool usePlatformFontList = true;
#if defined(MOZ_WIDGET_GTK)
    usePlatformFontList = gfxPlatformGtk::UseFcFontList();
#elif defined(MOZ_WIDGET_QT)
    usePlatformFontList = false;
#endif

    if (usePlatformFontList) {
        rv = gfxPlatformFontList::Init();
        if (NS_FAILED(rv)) {
            NS_RUNTIMEABORT("Could not initialize gfxPlatformFontList");
        }
    }

    gPlatform->mScreenReferenceSurface =
        gPlatform->CreateOffscreenSurface(IntSize(1, 1),
                                          gfxImageFormat::ARGB32);
    if (!gPlatform->mScreenReferenceSurface) {
        NS_RUNTIMEABORT("Could not initialize mScreenReferenceSurface");
    }

    gPlatform->mScreenReferenceDrawTarget =
        gPlatform->CreateOffscreenContentDrawTarget(IntSize(1, 1),
                                                    SurfaceFormat::B8G8R8A8);
    if (!gPlatform->mScreenReferenceDrawTarget) {
      NS_RUNTIMEABORT("Could not initialize mScreenReferenceDrawTarget");
    }

    rv = gfxFontCache::Init();
    if (NS_FAILED(rv)) {
        NS_RUNTIMEABORT("Could not initialize gfxFontCache");
    }

    /* Create and register our CMS Override observer. */
    gPlatform->mSRGBOverrideObserver = new SRGBOverrideObserver();
    Preferences::AddWeakObserver(gPlatform->mSRGBOverrideObserver, GFX_PREF_CMS_FORCE_SRGB);

    gPlatform->mFontPrefsObserver = new FontPrefsObserver();
    Preferences::AddStrongObservers(gPlatform->mFontPrefsObserver, kObservedPrefs);

    GLContext::PlatformStartup();

#ifdef MOZ_WIDGET_ANDROID
    // Texture pool init
    TexturePoolOGL::Init();
#endif

#ifdef MOZ_WIDGET_GONK
    mozilla::layers::InitGralloc();
#endif

    Preferences::RegisterCallbackAndCall(RecordingPrefChanged, "gfx.2d.recording", nullptr);

    CreateCMSOutputProfile();

    // Listen to memory pressure event so we can purge DrawTarget caches
    nsCOMPtr<nsIObserverService> obs = mozilla::services::GetObserverService();
    if (obs) {
        gPlatform->mMemoryPressureObserver = new MemoryPressureObserver();
        obs->AddObserver(gPlatform->mMemoryPressureObserver, "memory-pressure", false);
    }

    // Request the imgITools service, implicitly initializing ImageLib.
    nsCOMPtr<imgITools> imgTools = do_GetService("@mozilla.org/image/tools;1");
    if (!imgTools) {
      NS_RUNTIMEABORT("Could not initialize ImageLib");
    }

    RegisterStrongMemoryReporter(new GfxMemoryImageReporter());

    if (XRE_IsParentProcess()) {
      if (gfxPlatform::ForceSoftwareVsync()) {
        gPlatform->mVsyncSource = (gPlatform)->gfxPlatform::CreateHardwareVsyncSource();
      } else {
        gPlatform->mVsyncSource = gPlatform->CreateHardwareVsyncSource();
      }
    }
}

static bool sLayersIPCIsUp = false;

void
gfxPlatform::Shutdown()
{
    if (!gPlatform) {
      return;
    }

    MOZ_ASSERT(!sLayersIPCIsUp);

    // These may be called before the corresponding subsystems have actually
    // started up. That's OK, they can handle it.
    gfxFontCache::Shutdown();
    gfxFontGroup::Shutdown();
    gfxGradientCache::Shutdown();
    gfxAlphaBoxBlur::ShutdownBlurCache();
    gfxGraphiteShaper::Shutdown();
    gfxPlatformFontList::Shutdown();
    ShutdownTileCache();

    // Free the various non-null transforms and loaded profiles
    ShutdownCMS();

    // In some cases, gPlatform may not be created but Shutdown() called,
    // e.g., during xpcshell tests.
    if (gPlatform) {
        /* Unregister our CMS Override callback. */
        NS_ASSERTION(gPlatform->mSRGBOverrideObserver, "mSRGBOverrideObserver has alreay gone");
        Preferences::RemoveObserver(gPlatform->mSRGBOverrideObserver, GFX_PREF_CMS_FORCE_SRGB);
        gPlatform->mSRGBOverrideObserver = nullptr;

        NS_ASSERTION(gPlatform->mFontPrefsObserver, "mFontPrefsObserver has alreay gone");
        Preferences::RemoveObservers(gPlatform->mFontPrefsObserver, kObservedPrefs);
        gPlatform->mFontPrefsObserver = nullptr;

        NS_ASSERTION(gPlatform->mMemoryPressureObserver, "mMemoryPressureObserver has already gone");
        nsCOMPtr<nsIObserverService> obs = mozilla::services::GetObserverService();
        if (obs) {
            obs->RemoveObserver(gPlatform->mMemoryPressureObserver, "memory-pressure");
        }

        gPlatform->mMemoryPressureObserver = nullptr;
        gPlatform->mSkiaGlue = nullptr;
        gPlatform->mVsyncSource = nullptr;
    }

#ifdef MOZ_WIDGET_ANDROID
    // Shut down the texture pool
    TexturePoolOGL::Shutdown();
#endif

    // Shut down the default GL context provider.
    GLContextProvider::Shutdown();

#if defined(XP_WIN)
    // The above shutdown calls operate on the available context providers on
    // most platforms.  Windows is a "special snowflake", though, and has three
    // context providers available, so we have to shut all of them down.
    // We should only support the default GL provider on Windows; then, this
    // could go away. Unfortunately, we currently support WGL (the default) for
    // WebGL on Optimus.
    GLContextProviderEGL::Shutdown();
#endif

    // This is a bit iffy - we're assuming that we were the ones that set the
    // log forwarder in the Factory, so that it's our responsibility to
    // delete it.
    delete mozilla::gfx::Factory::GetLogForwarder();
    mozilla::gfx::Factory::SetLogForwarder(nullptr);

    gfx::Factory::ShutDown();

    delete gGfxPlatformPrefsLock;

    gfxPrefs::DestroySingleton();
    gfxFont::DestroySingletons();

    delete gPlatform;
    gPlatform = nullptr;
}

/* static */ void
gfxPlatform::InitLayersIPC()
{
    if (sLayersIPCIsUp) {
      return;
    }
    sLayersIPCIsUp = true;

    AsyncTransactionTrackersHolder::Initialize();

    if (XRE_IsParentProcess())
    {
        mozilla::layers::CompositorParent::StartUp();
#ifdef MOZ_WIDGET_GONK
        SharedBufferManagerChild::StartUp();
#endif
        mozilla::layers::ImageBridgeChild::StartUp();
    }
}

/* static */ void
gfxPlatform::ShutdownLayersIPC()
{
    if (!sLayersIPCIsUp) {
      return;
    }
    sLayersIPCIsUp = false;

    if (XRE_IsParentProcess())
    {
        // This must happen after the shutdown of media and widgets, which
        // are triggered by the NS_XPCOM_SHUTDOWN_OBSERVER_ID notification.
        layers::ImageBridgeChild::ShutDown();
#ifdef MOZ_WIDGET_GONK
        layers::SharedBufferManagerChild::ShutDown();
#endif

        layers::CompositorParent::ShutDown();
    }
}

gfxPlatform::~gfxPlatform()
{
    mScreenReferenceSurface = nullptr;
    mScreenReferenceDrawTarget = nullptr;

    // Clean up any VR stuff
    VRHMDManager::ManagerDestroy();

    // The cairo folks think we should only clean up in debug builds,
    // but we're generally in the habit of trying to shut down as
    // cleanly as possible even in production code, so call this
    // cairo_debug_* function unconditionally.
    //
    // because cairo can assert and thus crash on shutdown, don't do this in release builds
#ifdef NS_FREE_PERMANENT_DATA
#ifdef USE_SKIA
    // must do Skia cleanup before Cairo cleanup, because Skia may be referencing
    // Cairo objects e.g. through SkCairoFTTypeface
    SkGraphics::PurgeFontCache();
#endif

#if MOZ_TREE_CAIRO
    cairo_debug_reset_static_data();
#endif
#endif
}

cairo_user_data_key_t kDrawTarget;

already_AddRefed<DrawTarget>
gfxPlatform::CreateDrawTargetForSurface(gfxASurface *aSurface, const IntSize& aSize)
{
  SurfaceFormat format = aSurface->GetSurfaceFormat();
  RefPtr<DrawTarget> drawTarget = Factory::CreateDrawTargetForCairoSurface(aSurface->CairoSurface(), aSize, &format);
  if (!drawTarget) {
    gfxWarning() << "gfxPlatform::CreateDrawTargetForSurface failed in CreateDrawTargetForCairoSurface";
    return nullptr;
  }
  aSurface->SetData(&kDrawTarget, drawTarget, nullptr);
  return drawTarget.forget();
}

// This is a temporary function used by ContentClient to build a DrawTarget
// around the gfxASurface. This should eventually be replaced by plumbing
// the DrawTarget through directly
already_AddRefed<DrawTarget>
gfxPlatform::CreateDrawTargetForUpdateSurface(gfxASurface *aSurface, const IntSize& aSize)
{
#ifdef XP_MACOSX
  // this is a bit of a hack that assumes that the buffer associated with the CGContext
  // will live around long enough that nothing bad will happen.
  if (aSurface->GetType() == gfxSurfaceType::Quartz) {
    return Factory::CreateDrawTargetForCairoCGContext(static_cast<gfxQuartzSurface*>(aSurface)->GetCGContext(), aSize);
  }
#endif
  MOZ_CRASH("GFX: unused function");
  return nullptr;
}


cairo_user_data_key_t kSourceSurface;

/**
 * Record the backend that was used to construct the SourceSurface.
 * When getting the cached SourceSurface for a gfxASurface/DrawTarget pair,
 * we check to make sure the DrawTarget's backend matches the backend
 * for the cached SourceSurface, and only use it if they match. This
 * can avoid expensive and unnecessary readbacks.
 */
struct SourceSurfaceUserData
{
  RefPtr<SourceSurface> mSrcSurface;
  BackendType mBackendType;
};

void SourceBufferDestroy(void *srcSurfUD)
{
  delete static_cast<SourceSurfaceUserData*>(srcSurfUD);
}

UserDataKey kThebesSurface;

struct DependentSourceSurfaceUserData
{
  RefPtr<gfxASurface> mSurface;
};

void SourceSurfaceDestroyed(void *aData)
{
  delete static_cast<DependentSourceSurfaceUserData*>(aData);
}

void
gfxPlatform::ClearSourceSurfaceForSurface(gfxASurface *aSurface)
{
  aSurface->SetData(&kSourceSurface, nullptr, nullptr);
}

/* static */ already_AddRefed<SourceSurface>
gfxPlatform::GetSourceSurfaceForSurface(DrawTarget *aTarget, gfxASurface *aSurface)
{
  if (!aSurface->CairoSurface() || aSurface->CairoStatus()) {
    return nullptr;
  }

  if (!aTarget) {
    aTarget = gfxPlatform::GetPlatform()->ScreenReferenceDrawTarget();
    if (!aTarget) {
      return nullptr;
    }
  }

  void *userData = aSurface->GetData(&kSourceSurface);

  if (userData) {
    SourceSurfaceUserData *surf = static_cast<SourceSurfaceUserData*>(userData);

    if (surf->mSrcSurface->IsValid() && surf->mBackendType == aTarget->GetBackendType()) {
      RefPtr<SourceSurface> srcSurface(surf->mSrcSurface);
      return srcSurface.forget();
    }
    // We can just continue here as when setting new user data the destroy
    // function will be called for the old user data.
  }

  SurfaceFormat format = aSurface->GetSurfaceFormat();

  if (aTarget->GetBackendType() == BackendType::CAIRO) {
    // If we're going to be used with a CAIRO DrawTarget, then just create a
    // SourceSurfaceCairo since we don't know the underlying type of the CAIRO
    // DrawTarget and can't pick a better surface type. Doing this also avoids
    // readback of aSurface's surface into memory if, for example, aSurface
    // wraps an xlib cairo surface (which can be important to avoid a major
    // slowdown).
    NativeSurface surf;
    surf.mFormat = format;
    surf.mType = NativeSurfaceType::CAIRO_SURFACE;
    surf.mSurface = aSurface->CairoSurface();
    surf.mSize = aSurface->GetSize();
    // We return here regardless of whether CreateSourceSurfaceFromNativeSurface
    // succeeds or not since we don't expect to be able to do any better below
    // if it fails.
    //
    // Note that the returned SourceSurfaceCairo holds a strong reference to
    // the cairo_surface_t* that it wraps, which essencially means it holds a
    // strong reference to aSurface since aSurface shares its
    // cairo_surface_t*'s reference count variable. As a result we can't cache
    // srcBuffer on aSurface (see below) since aSurface would then hold a
    // strong reference back to srcBuffer, creating a reference loop and a
    // memory leak. Not caching is fine since wrapping is cheap enough (no
    // copying) so we can just wrap again next time we're called.
    return aTarget->CreateSourceSurfaceFromNativeSurface(surf);
  }

  RefPtr<SourceSurface> srcBuffer;

  // Currently no other DrawTarget types implement CreateSourceSurfaceFromNativeSurface

  if (!srcBuffer) {
    // If aSurface wraps data, we can create a SourceSurfaceRawData that wraps
    // the same data, then optimize it for aTarget:
    RefPtr<DataSourceSurface> surf = GetWrappedDataSourceSurface(aSurface);
    if (surf) {
      srcBuffer = aTarget->OptimizeSourceSurface(surf);
      if (srcBuffer == surf) {
        // GetWrappedDataSourceSurface returns a SourceSurface that holds a
        // strong reference to aSurface since it wraps aSurface's data and
        // needs it to stay alive. As a result we can't cache srcBuffer on
        // aSurface (below) since aSurface would then hold a strong reference
        // back to srcBuffer, creating a reference loop and a memory leak. Not
        // caching is fine since wrapping is cheap enough (no copying) so we
        // can just wrap again next time we're called.
        //
        // Note that the check below doesn't catch this since srcBuffer will be a
        // SourceSurfaceRawData object (even if aSurface is not a gfxImageSurface
        // object), which is why we need this separate check.
        return srcBuffer.forget();
      }
    }
  }

  if (!srcBuffer) {
    MOZ_ASSERT(aTarget->GetBackendType() != BackendType::CAIRO,
               "We already tried CreateSourceSurfaceFromNativeSurface with a "
               "DrawTargetCairo above");
    // We've run out of performant options. We now try creating a SourceSurface
    // using a temporary DrawTargetCairo and then optimizing it to aTarget's
    // actual type. The CreateSourceSurfaceFromNativeSurface() call will
    // likely create a DataSourceSurface (possibly involving copying and/or
    // readback), and the OptimizeSourceSurface may well copy again and upload
    // to the GPU. So, while this code path is rarely hit, hitting it may be
    // very slow.
    NativeSurface surf;
    surf.mFormat = format;
    surf.mType = NativeSurfaceType::CAIRO_SURFACE;
    surf.mSurface = aSurface->CairoSurface();
    surf.mSize = aSurface->GetSize();
    RefPtr<DrawTarget> drawTarget =
      Factory::CreateDrawTarget(BackendType::CAIRO, IntSize(1, 1), format);
    if (!drawTarget) {
      gfxWarning() << "gfxPlatform::GetSourceSurfaceForSurface failed in CreateDrawTarget";
      return nullptr;
    }
    srcBuffer = drawTarget->CreateSourceSurfaceFromNativeSurface(surf);
    if (srcBuffer) {
      srcBuffer = aTarget->OptimizeSourceSurface(srcBuffer);
    }
  }

  if (!srcBuffer) {
    return nullptr;
  }

  if ((srcBuffer->GetType() == SurfaceType::CAIRO &&
       static_cast<SourceSurfaceCairo*>(srcBuffer.get())->GetSurface() ==
         aSurface->CairoSurface()) ||
      (srcBuffer->GetType() == SurfaceType::CAIRO_IMAGE &&
       static_cast<DataSourceSurfaceCairo*>(srcBuffer.get())->GetSurface() ==
         aSurface->CairoSurface())) {
    // See the "Note that the returned SourceSurfaceCairo..." comment above.
    return srcBuffer.forget();
  }

  // Add user data to aSurface so we can cache lookups in the future.
  SourceSurfaceUserData *srcSurfUD = new SourceSurfaceUserData;
  srcSurfUD->mBackendType = aTarget->GetBackendType();
  srcSurfUD->mSrcSurface = srcBuffer;
  aSurface->SetData(&kSourceSurface, srcSurfUD, SourceBufferDestroy);

  return srcBuffer.forget();
}

already_AddRefed<DataSourceSurface>
gfxPlatform::GetWrappedDataSourceSurface(gfxASurface* aSurface)
{
  RefPtr<gfxImageSurface> image = aSurface->GetAsImageSurface();
  if (!image) {
    return nullptr;
  }
  RefPtr<DataSourceSurface> result =
    Factory::CreateWrappingDataSourceSurface(image->Data(),
                                             image->Stride(),
                                             image->GetSize(),
                                             ImageFormatToSurfaceFormat(image->Format()));

  if (!result) {
    return nullptr;
  }

  // If we wrapped the underlying data of aSurface, then we need to add user data
  // to make sure aSurface stays alive until we are done with the data.
  DependentSourceSurfaceUserData *srcSurfUD = new DependentSourceSurfaceUserData;
  srcSurfUD->mSurface = aSurface;
  result->AddUserData(&kThebesSurface, srcSurfUD, SourceSurfaceDestroyed);

  return result.forget();
}

already_AddRefed<ScaledFont>
gfxPlatform::GetScaledFontForFont(DrawTarget* aTarget, gfxFont *aFont)
{
  NativeFont nativeFont;
  nativeFont.mType = NativeFontType::CAIRO_FONT_FACE;
  nativeFont.mFont = aFont->GetCairoScaledFont();
  return Factory::CreateScaledFontForNativeFont(nativeFont,
                                                aFont->GetAdjustedSize());
}

int
gfxPlatform::GetTileWidth()
{
  MOZ_ASSERT(mTileWidth != -1);
  return mTileWidth;
}

int
gfxPlatform::GetTileHeight()
{
  MOZ_ASSERT(mTileHeight != -1);
  return mTileHeight;
}

void
gfxPlatform::SetTileSize(int aWidth, int aHeight)
{
  // Don't allow changing the tile size after we've set it.
  // Right now the code assumes that the tile size doesn't change.
  MOZ_ASSERT((mTileWidth == -1 && mTileHeight == -1) ||
    (mTileWidth == aWidth && mTileHeight == aHeight));

  mTileWidth = aWidth;
  mTileHeight = aHeight;
}

void
gfxPlatform::ComputeTileSize()
{
  // The tile size should be picked in the parent processes
  // and sent to the child processes over IPDL GetTileSize.
  if (!XRE_IsParentProcess()) {
    return;
  }

  int32_t w = gfxPrefs::LayersTileWidth();
  int32_t h = gfxPrefs::LayersTileHeight();

  if (gfxPrefs::LayersTilesAdjust()) {
    gfx::IntSize screenSize = GetScreenSize();
    if (screenSize.width > 0) {
      // FIXME: we should probably make sure this is within the max texture size,
      // but I think everything should at least support 1024
      w = h = std::max(std::min(NextPowerOfTwo(screenSize.width) / 2, 1024), 256);
    }

#ifdef MOZ_WIDGET_GONK
    android::sp<android::GraphicBuffer> alloc =
          new android::GraphicBuffer(w, h, android::PIXEL_FORMAT_RGBA_8888,
                                     android::GraphicBuffer::USAGE_SW_READ_OFTEN |
                                     android::GraphicBuffer::USAGE_SW_WRITE_OFTEN |
                                     android::GraphicBuffer::USAGE_HW_TEXTURE);

    if (alloc.get()) {
      w = alloc->getStride(); // We want the tiles to be gralloc stride aligned.
    }
#endif
  }

  SetTileSize(w, h);
}

void
gfxPlatform::PopulateScreenInfo()
{
  nsCOMPtr<nsIScreenManager> manager = do_GetService("@mozilla.org/gfx/screenmanager;1");
  MOZ_ASSERT(manager, "failed to get nsIScreenManager");

  nsCOMPtr<nsIScreen> screen;
  manager->GetPrimaryScreen(getter_AddRefs(screen));
  if (!screen) {
    // This can happen in xpcshell, for instance
    return;
  }

  screen->GetColorDepth(&mScreenDepth);

  int left, top;
  screen->GetRect(&left, &top, &mScreenSize.width, &mScreenSize.height);
}

bool
gfxPlatform::SupportsAzureContentForDrawTarget(DrawTarget* aTarget)
{
  if (!aTarget) {
    return false;
  }

  return SupportsAzureContentForType(aTarget->GetBackendType());
}

bool
gfxPlatform::UseAcceleratedSkiaCanvas()
{
  return gfxPrefs::CanvasAzureAccelerated() &&
         mPreferredCanvasBackend == BackendType::SKIA;
}

bool gfxPlatform::HaveChoiceOfHWAndSWCanvas()
{
  return mPreferredCanvasBackend == BackendType::SKIA;
}

void
gfxPlatform::InitializeSkiaCacheLimits()
{
  if (UseAcceleratedSkiaCanvas()) {
#ifdef USE_SKIA_GPU
    bool usingDynamicCache = gfxPrefs::CanvasSkiaGLDynamicCache();
    int cacheItemLimit = gfxPrefs::CanvasSkiaGLCacheItems();
    int cacheSizeLimit = gfxPrefs::CanvasSkiaGLCacheSize();

    // Prefs are in megabytes, but we want the sizes in bytes
    cacheSizeLimit *= 1024*1024;

    if (usingDynamicCache) {
      if (mTotalSystemMemory < 512*1024*1024) {
        // We need a very minimal cache on anything smaller than 512mb.
        // Note the large jump as we cross 512mb (from 2mb to 32mb).
        cacheSizeLimit = 2*1024*1024;
      } else if (mTotalSystemMemory > 0) {
        cacheSizeLimit = mTotalSystemMemory / 16;
      }
    }

  #ifdef DEBUG
    printf_stderr("Determined SkiaGL cache limits: Size %i, Items: %i\n", cacheSizeLimit, cacheItemLimit);
  #endif

    mSkiaGlue->GetGrContext()->setResourceCacheLimits(cacheItemLimit, cacheSizeLimit);
#endif
  }
}

SkiaGLGlue*
gfxPlatform::GetSkiaGLGlue()
{
#ifdef USE_SKIA_GPU
  if (!gfxPlatform::GetPlatform()->UseAcceleratedSkiaCanvas()) {
    gfxCriticalNote << "Accelerated Skia canvas is disabled";
    return nullptr;
  }

  if (!mSkiaGlue) {
    /* Dummy context. We always draw into a FBO.
     *
     * FIXME: This should be stored in TLS or something, since there needs to be one for each thread using it. As it
     * stands, this only works on the main thread.
     */
    RefPtr<GLContext> glContext;
    glContext = GLContextProvider::CreateHeadless(CreateContextFlags::REQUIRE_COMPAT_PROFILE |
                                                  CreateContextFlags::ALLOW_OFFLINE_RENDERER);
    if (!glContext) {
      printf_stderr("Failed to create GLContext for SkiaGL!\n");
      return nullptr;
    }
    mSkiaGlue = new SkiaGLGlue(glContext);
    MOZ_ASSERT(mSkiaGlue->GetGrContext(), "No GrContext");
    InitializeSkiaCacheLimits();
  }
#endif

  return mSkiaGlue;
}

void
gfxPlatform::PurgeSkiaCache()
{
#ifdef USE_SKIA_GPU
  if (!mSkiaGlue)
      return;

  mSkiaGlue->GetGrContext()->freeGpuResources();
  // GrContext::flush() doesn't call glFlush. Call it here.
  mSkiaGlue->GetGLContext()->MakeCurrent();
  mSkiaGlue->GetGLContext()->fFlush();
#endif
}

bool
gfxPlatform::HasEnoughTotalSystemMemoryForSkiaGL()
{
#ifdef MOZ_WIDGET_GONK
  if (mTotalSystemMemory < 250*1024*1024) {
    return false;
  }
#endif
  return true;
}

already_AddRefed<DrawTarget>
gfxPlatform::CreateDrawTargetForBackend(BackendType aBackend, const IntSize& aSize, SurfaceFormat aFormat)
{
  // There is a bunch of knowledge in the gfxPlatform heirarchy about how to
  // create the best offscreen surface for the current system and situation. We
  // can easily take advantage of this for the Cairo backend, so that's what we
  // do.
  // mozilla::gfx::Factory can get away without having all this knowledge for
  // now, but this might need to change in the future (using
  // CreateOffscreenSurface() and CreateDrawTargetForSurface() for all
  // backends).
  if (aBackend == BackendType::CAIRO) {
    RefPtr<gfxASurface> surf = CreateOffscreenSurface(aSize, SurfaceFormatToImageFormat(aFormat));
    if (!surf || surf->CairoStatus()) {
      return nullptr;
    }

    return CreateDrawTargetForSurface(surf, aSize);
  } else {
    return Factory::CreateDrawTarget(aBackend, aSize, aFormat);
  }
}

already_AddRefed<DrawTarget>
gfxPlatform::CreateOffscreenCanvasDrawTarget(const IntSize& aSize, SurfaceFormat aFormat)
{
  NS_ASSERTION(mPreferredCanvasBackend != BackendType::NONE, "No backend.");
  RefPtr<DrawTarget> target = CreateDrawTargetForBackend(mPreferredCanvasBackend, aSize, aFormat);
  if (target ||
      mFallbackCanvasBackend == BackendType::NONE) {
    return target.forget();
  }

#ifdef XP_WIN
  // On Windows, the fallback backend (Cairo) should use its image backend.
  return Factory::CreateDrawTarget(mFallbackCanvasBackend, aSize, aFormat);
#else
  return CreateDrawTargetForBackend(mFallbackCanvasBackend, aSize, aFormat);
#endif
}

already_AddRefed<DrawTarget>
gfxPlatform::CreateOffscreenContentDrawTarget(const IntSize& aSize, SurfaceFormat aFormat)
{
  NS_ASSERTION(mPreferredCanvasBackend != BackendType::NONE, "No backend.");
  return CreateDrawTargetForBackend(mContentBackend, aSize, aFormat);
}

already_AddRefed<DrawTarget>
gfxPlatform::CreateDrawTargetForData(unsigned char* aData, const IntSize& aSize, int32_t aStride, SurfaceFormat aFormat)
{
  NS_ASSERTION(mContentBackend != BackendType::NONE, "No backend.");

  BackendType backendType = mContentBackend;

  if (!Factory::DoesBackendSupportDataDrawtarget(mContentBackend)) {
    backendType = BackendType::CAIRO;
  }

  RefPtr<DrawTarget> dt = Factory::CreateDrawTargetForData(backendType,
                                                           aData, aSize,
                                                           aStride, aFormat);

  return dt.forget();
}

/* static */ BackendType
gfxPlatform::BackendTypeForName(const nsCString& aName)
{
  if (aName.EqualsLiteral("cairo"))
    return BackendType::CAIRO;
  if (aName.EqualsLiteral("skia"))
    return BackendType::SKIA;
  if (aName.EqualsLiteral("direct2d"))
    return BackendType::DIRECT2D;
  if (aName.EqualsLiteral("direct2d1.1"))
    return BackendType::DIRECT2D1_1;
  if (aName.EqualsLiteral("cg"))
    return BackendType::COREGRAPHICS;
  return BackendType::NONE;
}

nsresult
gfxPlatform::GetFontList(nsIAtom *aLangGroup,
                         const nsACString& aGenericFamily,
                         nsTArray<nsString>& aListOfFonts)
{
    return NS_ERROR_NOT_IMPLEMENTED;
}

nsresult
gfxPlatform::UpdateFontList()
{
    return NS_ERROR_NOT_IMPLEMENTED;
}

bool
gfxPlatform::DownloadableFontsEnabled()
{
    if (mAllowDownloadableFonts == UNINITIALIZED_VALUE) {
        mAllowDownloadableFonts =
            Preferences::GetBool(GFX_DOWNLOADABLE_FONTS_ENABLED, false);
    }

    return mAllowDownloadableFonts;
}

bool
gfxPlatform::UseCmapsDuringSystemFallback()
{
    if (mFallbackUsesCmaps == UNINITIALIZED_VALUE) {
        mFallbackUsesCmaps =
            Preferences::GetBool(GFX_PREF_FALLBACK_USE_CMAPS, false);
    }

    return mFallbackUsesCmaps;
}

bool
gfxPlatform::OpenTypeSVGEnabled()
{
    if (mOpenTypeSVGEnabled == UNINITIALIZED_VALUE) {
        mOpenTypeSVGEnabled =
            Preferences::GetBool(GFX_PREF_OPENTYPE_SVG, false);
    }

    return mOpenTypeSVGEnabled > 0;
}

uint32_t
gfxPlatform::WordCacheCharLimit()
{
    if (mWordCacheCharLimit == UNINITIALIZED_VALUE) {
        mWordCacheCharLimit =
            Preferences::GetInt(GFX_PREF_WORD_CACHE_CHARLIMIT, 32);
        if (mWordCacheCharLimit < 0) {
            mWordCacheCharLimit = 32;
        }
    }

    return uint32_t(mWordCacheCharLimit);
}

uint32_t
gfxPlatform::WordCacheMaxEntries()
{
    if (mWordCacheMaxEntries == UNINITIALIZED_VALUE) {
        mWordCacheMaxEntries =
            Preferences::GetInt(GFX_PREF_WORD_CACHE_MAXENTRIES, 10000);
        if (mWordCacheMaxEntries < 0) {
            mWordCacheMaxEntries = 10000;
        }
    }

    return uint32_t(mWordCacheMaxEntries);
}

bool
gfxPlatform::UseGraphiteShaping()
{
    if (mGraphiteShapingEnabled == UNINITIALIZED_VALUE) {
        mGraphiteShapingEnabled =
            Preferences::GetBool(GFX_PREF_GRAPHITE_SHAPING, false);
    }

    return mGraphiteShapingEnabled;
}

gfxFontEntry*
gfxPlatform::MakePlatformFont(const nsAString& aFontName,
                              uint16_t aWeight,
                              int16_t aStretch,
                              uint8_t aStyle,
                              const uint8_t* aFontData,
                              uint32_t aLength)
{
    // Default implementation does not handle activating downloaded fonts;
    // just free the data and return.
    // Platforms that support @font-face must override this,
    // using the data to instantiate the font, and taking responsibility
    // for freeing it when no longer required.
    if (aFontData) {
        free((void*)aFontData);
    }
    return nullptr;
}

mozilla::layers::DiagnosticTypes
gfxPlatform::GetLayerDiagnosticTypes()
{
  mozilla::layers::DiagnosticTypes type = DiagnosticTypes::NO_DIAGNOSTIC;
  if (gfxPrefs::DrawLayerBorders()) {
    type |= mozilla::layers::DiagnosticTypes::LAYER_BORDERS;
  }
  if (gfxPrefs::DrawTileBorders()) {
    type |= mozilla::layers::DiagnosticTypes::TILE_BORDERS;
  }
  if (gfxPrefs::DrawBigImageBorders()) {
    type |= mozilla::layers::DiagnosticTypes::BIGIMAGE_BORDERS;
  }
  if (gfxPrefs::FlashLayerBorders()) {
    type |= mozilla::layers::DiagnosticTypes::FLASH_BORDERS;
  }
  return type;
}

void
gfxPlatform::InitBackendPrefs(uint32_t aCanvasBitmask, BackendType aCanvasDefault,
                              uint32_t aContentBitmask, BackendType aContentDefault)
{
    mPreferredCanvasBackend = GetCanvasBackendPref(aCanvasBitmask);
    if (mPreferredCanvasBackend == BackendType::NONE) {
        mPreferredCanvasBackend = aCanvasDefault;
    }

    if (mPreferredCanvasBackend == BackendType::DIRECT2D1_1) {
      // Falling back to D2D 1.0 won't help us here. When D2D 1.1 DT creation
      // fails it means the surface was too big or there's something wrong with
      // the device. D2D 1.0 will encounter a similar situation.
      mFallbackCanvasBackend =
          GetCanvasBackendPref(aCanvasBitmask &
                               ~(BackendTypeBit(mPreferredCanvasBackend) | BackendTypeBit(BackendType::DIRECT2D)));
    } else {
      mFallbackCanvasBackend =
          GetCanvasBackendPref(aCanvasBitmask & ~BackendTypeBit(mPreferredCanvasBackend));
    }

    mContentBackendBitmask = aContentBitmask;
    mContentBackend = GetContentBackendPref(mContentBackendBitmask);
    if (mContentBackend == BackendType::NONE) {
        mContentBackend = aContentDefault;
        // mContentBackendBitmask is our canonical reference for supported
        // backends so we need to add the default if we are using it and
        // overriding the prefs.
        mContentBackendBitmask |= BackendTypeBit(aContentDefault);
    }
}

/* static */ BackendType
gfxPlatform::GetCanvasBackendPref(uint32_t aBackendBitmask)
{
    return GetBackendPref("gfx.canvas.azure.backends", aBackendBitmask);
}

/* static */ BackendType
gfxPlatform::GetContentBackendPref(uint32_t &aBackendBitmask)
{
    return GetBackendPref("gfx.content.azure.backends", aBackendBitmask);
}

/* static */ BackendType
gfxPlatform::GetBackendPref(const char* aBackendPrefName, uint32_t &aBackendBitmask)
{
    nsTArray<nsCString> backendList;
    nsCString prefString;
    if (NS_SUCCEEDED(Preferences::GetCString(aBackendPrefName, &prefString))) {
        ParseString(prefString, ',', backendList);
    }

    uint32_t allowedBackends = 0;
    BackendType result = BackendType::NONE;
    for (uint32_t i = 0; i < backendList.Length(); ++i) {
        BackendType type = BackendTypeForName(backendList[i]);
        if (BackendTypeBit(type) & aBackendBitmask) {
            allowedBackends |= BackendTypeBit(type);
            if (result == BackendType::NONE) {
                result = type;
            }
        }
    }

    aBackendBitmask = allowedBackends;
    return result;
}

bool
gfxPlatform::InSafeMode()
{
  static bool sSafeModeInitialized = false;
  static bool sInSafeMode = false;

  if (!sSafeModeInitialized) {
    sSafeModeInitialized = true;
    nsCOMPtr<nsIXULRuntime> xr = do_GetService("@mozilla.org/xre/runtime;1");
    if (xr) {
      xr->GetInSafeMode(&sInSafeMode);
    }
  }
  return sInSafeMode;
}

bool
gfxPlatform::OffMainThreadCompositingEnabled()
{
  return UsesOffMainThreadCompositing();
}

eCMSMode
gfxPlatform::GetCMSMode()
{
    if (!gCMSInitialized) {
        int32_t mode = gfxPrefs::CMSMode();
        if (mode >= 0 && mode < eCMSMode_AllCount) {
            gCMSMode = static_cast<eCMSMode>(mode);
        }

        bool enableV4 = gfxPrefs::CMSEnableV4();
        if (enableV4) {
            qcms_enable_iccv4();
        }
        gCMSInitialized = true;
    }
    return gCMSMode;
}

int
gfxPlatform::GetRenderingIntent()
{
  // gfxPrefs.h is using 0 as the default for the rendering
  // intent preference, based on that being the value for
  // QCMS_INTENT_DEFAULT.  Assert here to catch if that ever
  // changes and we can then figure out what to do about it.
  MOZ_ASSERT(QCMS_INTENT_DEFAULT == 0);

  /* Try to query the pref system for a rendering intent. */
  int32_t pIntent = gfxPrefs::CMSRenderingIntent();
  if ((pIntent < QCMS_INTENT_MIN) || (pIntent > QCMS_INTENT_MAX)) {
    /* If the pref is out of range, use embedded profile. */
    pIntent = -1;
  }
  return pIntent;
}

void
gfxPlatform::TransformPixel(const Color& in, Color& out, qcms_transform *transform)
{

    if (transform) {
        /* we want the bytes in RGB order */
#ifdef IS_LITTLE_ENDIAN
        /* ABGR puts the bytes in |RGBA| order on little endian */
        uint32_t packed = in.ToABGR();
        qcms_transform_data(transform,
                       (uint8_t *)&packed, (uint8_t *)&packed,
                       1);
        out = Color::FromABGR(packed);
#else
        /* ARGB puts the bytes in |ARGB| order on big endian */
        uint32_t packed = in.UnusualToARGB();
        /* add one to move past the alpha byte */
        qcms_transform_data(transform,
                       (uint8_t *)&packed + 1, (uint8_t *)&packed + 1,
                       1);
        out = Color::UnusualFromARGB(packed);
#endif
    }

    else if (&out != &in)
        out = in;
}

void
gfxPlatform::GetPlatformCMSOutputProfile(void *&mem, size_t &size)
{
    mem = nullptr;
    size = 0;
}

void
gfxPlatform::GetCMSOutputProfileData(void *&mem, size_t &size)
{
    nsAdoptingCString fname = Preferences::GetCString("gfx.color_management.display_profile");
    if (!fname.IsEmpty()) {
        qcms_data_from_path(fname, &mem, &size);
    }
    else {
        gfxPlatform::GetPlatform()->GetPlatformCMSOutputProfile(mem, size);
    }
}

void
gfxPlatform::CreateCMSOutputProfile()
{
    if (!gCMSOutputProfile) {
        /* Determine if we're using the internal override to force sRGB as
           an output profile for reftests. See Bug 452125.

           Note that we don't normally (outside of tests) set a
           default value of this preference, which means nsIPrefBranch::GetBoolPref
           will typically throw (and leave its out-param untouched).
         */
        if (Preferences::GetBool(GFX_PREF_CMS_FORCE_SRGB, false)) {
            gCMSOutputProfile = GetCMSsRGBProfile();
        }

        if (!gCMSOutputProfile) {
            void* mem = nullptr;
            size_t size = 0;

            GetCMSOutputProfileData(mem, size);
            if ((mem != nullptr) && (size > 0)) {
                gCMSOutputProfile = qcms_profile_from_memory(mem, size);
                free(mem);
            }
        }

        /* Determine if the profile looks bogus. If so, close the profile
         * and use sRGB instead. See bug 460629, */
        if (gCMSOutputProfile && qcms_profile_is_bogus(gCMSOutputProfile)) {
            NS_ASSERTION(gCMSOutputProfile != GetCMSsRGBProfile(),
                         "Builtin sRGB profile tagged as bogus!!!");
            qcms_profile_release(gCMSOutputProfile);
            gCMSOutputProfile = nullptr;
        }

        if (!gCMSOutputProfile) {
            gCMSOutputProfile = GetCMSsRGBProfile();
        }
        /* Precache the LUT16 Interpolations for the output profile. See
           bug 444661 for details. */
        qcms_profile_precache_output_transform(gCMSOutputProfile);
    }
}

qcms_profile *
gfxPlatform::GetCMSOutputProfile()
{
    return gCMSOutputProfile;
}

qcms_profile *
gfxPlatform::GetCMSsRGBProfile()
{
    if (!gCMSsRGBProfile) {

        /* Create the profile using qcms. */
        gCMSsRGBProfile = qcms_profile_sRGB();
    }
    return gCMSsRGBProfile;
}

qcms_transform *
gfxPlatform::GetCMSRGBTransform()
{
    if (!gCMSRGBTransform && !gCMSRGBTransformFailed) {
        qcms_profile *inProfile, *outProfile;
        outProfile = GetCMSOutputProfile();
        inProfile = GetCMSsRGBProfile();

        if (!inProfile || !outProfile)
            return nullptr;

        gCMSRGBTransform = qcms_transform_create(inProfile, QCMS_DATA_RGB_8,
                                              outProfile, QCMS_DATA_RGB_8,
                                             QCMS_INTENT_PERCEPTUAL);
        if (!gCMSRGBTransform) {
            gCMSRGBTransformFailed = true;
        }
    }

    return gCMSRGBTransform;
}

qcms_transform *
gfxPlatform::GetCMSInverseRGBTransform()
{
    if (!gCMSInverseRGBTransform) {
        qcms_profile *inProfile, *outProfile;
        inProfile = GetCMSOutputProfile();
        outProfile = GetCMSsRGBProfile();

        if (!inProfile || !outProfile)
            return nullptr;

        gCMSInverseRGBTransform = qcms_transform_create(inProfile, QCMS_DATA_RGB_8,
                                                     outProfile, QCMS_DATA_RGB_8,
                                                     QCMS_INTENT_PERCEPTUAL);
    }

    return gCMSInverseRGBTransform;
}

qcms_transform *
gfxPlatform::GetCMSRGBATransform()
{
    if (!gCMSRGBATransform) {
        qcms_profile *inProfile, *outProfile;
        outProfile = GetCMSOutputProfile();
        inProfile = GetCMSsRGBProfile();

        if (!inProfile || !outProfile)
            return nullptr;

        gCMSRGBATransform = qcms_transform_create(inProfile, QCMS_DATA_RGBA_8,
                                               outProfile, QCMS_DATA_RGBA_8,
                                               QCMS_INTENT_PERCEPTUAL);
    }

    return gCMSRGBATransform;
}

/* Shuts down various transforms and profiles for CMS. */
static void ShutdownCMS()
{

    if (gCMSRGBTransform) {
        qcms_transform_release(gCMSRGBTransform);
        gCMSRGBTransform = nullptr;
    }
    if (gCMSInverseRGBTransform) {
        qcms_transform_release(gCMSInverseRGBTransform);
        gCMSInverseRGBTransform = nullptr;
    }
    if (gCMSRGBATransform) {
        qcms_transform_release(gCMSRGBATransform);
        gCMSRGBATransform = nullptr;
    }
    if (gCMSOutputProfile) {
        qcms_profile_release(gCMSOutputProfile);

        // handle the aliased case
        if (gCMSsRGBProfile == gCMSOutputProfile)
            gCMSsRGBProfile = nullptr;
        gCMSOutputProfile = nullptr;
    }
    if (gCMSsRGBProfile) {
        qcms_profile_release(gCMSsRGBProfile);
        gCMSsRGBProfile = nullptr;
    }

    // Reset the state variables
    gCMSMode = eCMSMode_Off;
    gCMSInitialized = false;
}

// default SetupClusterBoundaries, based on Unicode properties;
// platform subclasses may override if they wish
void
gfxPlatform::SetupClusterBoundaries(gfxTextRun *aTextRun, const char16_t *aString)
{
    if (aTextRun->GetFlags() & gfxTextRunFactory::TEXT_IS_8BIT) {
        // 8-bit text doesn't have clusters.
        // XXX is this true in all languages???
        // behdad: don't think so.  Czech for example IIRC has a
        // 'ch' grapheme.
        // jfkthame: but that's not expected to behave as a grapheme cluster
        // for selection/editing/etc.
        return;
    }

    aTextRun->SetupClusterBoundaries(0, aString, aTextRun->GetLength());
}

int32_t
gfxPlatform::GetBidiNumeralOption()
{
    if (mBidiNumeralOption == UNINITIALIZED_VALUE) {
        mBidiNumeralOption = Preferences::GetInt(BIDI_NUMERAL_PREF, 0);
    }
    return mBidiNumeralOption;
}

/* static */ void
gfxPlatform::FlushFontAndWordCaches()
{
    gfxFontCache *fontCache = gfxFontCache::GetCache();
    if (fontCache) {
        fontCache->AgeAllGenerations();
        fontCache->FlushShapedWordCaches();
    }
}

void
gfxPlatform::FontsPrefsChanged(const char *aPref)
{
    NS_ASSERTION(aPref != nullptr, "null preference");
    if (!strcmp(GFX_DOWNLOADABLE_FONTS_ENABLED, aPref)) {
        mAllowDownloadableFonts = UNINITIALIZED_VALUE;
    } else if (!strcmp(GFX_PREF_FALLBACK_USE_CMAPS, aPref)) {
        mFallbackUsesCmaps = UNINITIALIZED_VALUE;
    } else if (!strcmp(GFX_PREF_WORD_CACHE_CHARLIMIT, aPref)) {
        mWordCacheCharLimit = UNINITIALIZED_VALUE;
        FlushFontAndWordCaches();
    } else if (!strcmp(GFX_PREF_WORD_CACHE_MAXENTRIES, aPref)) {
        mWordCacheMaxEntries = UNINITIALIZED_VALUE;
        FlushFontAndWordCaches();
    } else if (!strcmp(GFX_PREF_GRAPHITE_SHAPING, aPref)) {
        mGraphiteShapingEnabled = UNINITIALIZED_VALUE;
        FlushFontAndWordCaches();
    } else if (!strcmp(BIDI_NUMERAL_PREF, aPref)) {
        mBidiNumeralOption = UNINITIALIZED_VALUE;
    } else if (!strcmp(GFX_PREF_OPENTYPE_SVG, aPref)) {
        mOpenTypeSVGEnabled = UNINITIALIZED_VALUE;
        gfxFontCache::GetCache()->AgeAllGenerations();
    }
}


mozilla::LogModule*
gfxPlatform::GetLog(eGfxLog aWhichLog)
{
    // logs shared across gfx
    static LazyLogModule sFontlistLog("fontlist");
    static LazyLogModule sFontInitLog("fontinit");
    static LazyLogModule sTextrunLog("textrun");
    static LazyLogModule sTextrunuiLog("textrunui");
    static LazyLogModule sCmapDataLog("cmapdata");
    static LazyLogModule sTextPerfLog("textperf");

    switch (aWhichLog) {
    case eGfxLog_fontlist:
        return sFontlistLog;
    case eGfxLog_fontinit:
        return sFontInitLog;
    case eGfxLog_textrun:
        return sTextrunLog;
    case eGfxLog_textrunui:
        return sTextrunuiLog;
    case eGfxLog_cmapdata:
        return sCmapDataLog;
    case eGfxLog_textperf:
        return sTextPerfLog;
    }

    MOZ_ASSERT_UNREACHABLE("Unexpected log type");
    return nullptr;
}

mozilla::gfx::SurfaceFormat
gfxPlatform::Optimal2DFormatForContent(gfxContentType aContent)
{
  switch (aContent) {
  case gfxContentType::COLOR:
    switch (GetOffscreenFormat()) {
    case gfxImageFormat::ARGB32:
      return mozilla::gfx::SurfaceFormat::B8G8R8A8;
    case gfxImageFormat::RGB24:
      return mozilla::gfx::SurfaceFormat::B8G8R8X8;
    case gfxImageFormat::RGB16_565:
      return mozilla::gfx::SurfaceFormat::R5G6B5_UINT16;
    default:
      NS_NOTREACHED("unknown gfxImageFormat for gfxContentType::COLOR");
      return mozilla::gfx::SurfaceFormat::B8G8R8A8;
    }
  case gfxContentType::ALPHA:
    return mozilla::gfx::SurfaceFormat::A8;
  case gfxContentType::COLOR_ALPHA:
    return mozilla::gfx::SurfaceFormat::B8G8R8A8;
  default:
    NS_NOTREACHED("unknown gfxContentType");
    return mozilla::gfx::SurfaceFormat::B8G8R8A8;
  }
}

gfxImageFormat
gfxPlatform::OptimalFormatForContent(gfxContentType aContent)
{
  switch (aContent) {
  case gfxContentType::COLOR:
    return GetOffscreenFormat();
  case gfxContentType::ALPHA:
    return gfxImageFormat::A8;
  case gfxContentType::COLOR_ALPHA:
    return gfxImageFormat::ARGB32;
  default:
    NS_NOTREACHED("unknown gfxContentType");
    return gfxImageFormat::ARGB32;
  }
}

/**
 * There are a number of layers acceleration (or layers in general) preferences
 * that should be consistent for the lifetime of the application (bug 840967).
 * As such, we will evaluate them all as soon as one of them is evaluated
 * and remember the values.  Changing these preferences during the run will
 * not have any effect until we restart.
 */
static bool sLayersSupportsD3D9 = false;
static bool sLayersSupportsD3D11 = false;
bool gANGLESupportsD3D11 = false;
static bool sLayersSupportsHardwareVideoDecoding = false;
static bool sLayersHardwareVideoDecodingFailed = false;
static bool sBufferRotationCheckPref = true;
static bool sPrefBrowserTabsRemoteAutostart = false;

static bool sLayersAccelerationPrefsInitialized = false;

void
InitLayersAccelerationPrefs()
{
  if (!sLayersAccelerationPrefsInitialized)
  {
    // If this is called for the first time on a non-main thread, we're screwed.
    // At the moment there's no explicit guarantee that the main thread calls
    // this before the compositor thread, but let's at least make the assumption
    // explicit.
    MOZ_ASSERT(NS_IsMainThread(), "can only initialize prefs on the main thread");

    gfxPrefs::GetSingleton();
    sPrefBrowserTabsRemoteAutostart = BrowserTabsRemoteAutostart();

    nsCOMPtr<nsIGfxInfo> gfxInfo = services::GetGfxInfo();
    int32_t status;
#ifdef XP_WIN
    if (gfxPrefs::LayersAccelerationForceEnabled()) {
      sLayersSupportsD3D9 = true;
      sLayersSupportsD3D11 = true;
    } else if (gfxInfo) {
      if (NS_SUCCEEDED(gfxInfo->GetFeatureStatus(nsIGfxInfo::FEATURE_DIRECT3D_9_LAYERS, &status))) {
        if (status == nsIGfxInfo::FEATURE_STATUS_OK) {
          sLayersSupportsD3D9 = true;
        }
      }
      if (NS_SUCCEEDED(gfxInfo->GetFeatureStatus(nsIGfxInfo::FEATURE_DIRECT3D_11_LAYERS, &status))) {
        if (status == nsIGfxInfo::FEATURE_STATUS_OK) {
          sLayersSupportsD3D11 = true;
        }
      }
      if (!gfxPrefs::LayersD3D11DisableWARP()) {
        // Always support D3D11 when WARP is allowed.
        sLayersSupportsD3D11 = true;
      }
      if (NS_SUCCEEDED(gfxInfo->GetFeatureStatus(nsIGfxInfo::FEATURE_DIRECT3D_11_ANGLE, &status))) {
        if (status == nsIGfxInfo::FEATURE_STATUS_OK) {
          gANGLESupportsD3D11 = true;
        }
      }
    }
#endif

    if (Preferences::GetBool("media.hardware-video-decoding.enabled", false) &&
#ifdef XP_WIN
        Preferences::GetBool("media.windows-media-foundation.use-dxva", true) &&
#endif
        NS_SUCCEEDED(gfxInfo->GetFeatureStatus(nsIGfxInfo::FEATURE_HARDWARE_VIDEO_DECODING,
                                               &status))) {
      if (status == nsIGfxInfo::FEATURE_STATUS_OK) {
        sLayersSupportsHardwareVideoDecoding = true;
      }
    }

    Preferences::AddBoolVarCache(&sLayersHardwareVideoDecodingFailed,
                                 "media.hardware-video-decoding.failed",
                                 false);

    sLayersAccelerationPrefsInitialized = true;
  }
}

bool
gfxPlatform::CanUseDirect3D9()
{
  // this function is called from the compositor thread, so it is not
  // safe to init the prefs etc. from here.
  MOZ_ASSERT(sLayersAccelerationPrefsInitialized);
  return sLayersSupportsD3D9;
}

bool
gfxPlatform::CanUseDirect3D11()
{
  // this function is called from the compositor thread, so it is not
  // safe to init the prefs etc. from here.
  MOZ_ASSERT(sLayersAccelerationPrefsInitialized);
  return sLayersSupportsD3D11;
}

bool
gfxPlatform::CanUseHardwareVideoDecoding()
{
  // this function is called from the compositor thread, so it is not
  // safe to init the prefs etc. from here.
  MOZ_ASSERT(sLayersAccelerationPrefsInitialized);
  return sLayersSupportsHardwareVideoDecoding && !sLayersHardwareVideoDecodingFailed;
}

bool
gfxPlatform::CanUseDirect3D11ANGLE()
{
  MOZ_ASSERT(sLayersAccelerationPrefsInitialized);
  return gANGLESupportsD3D11;
}

bool
gfxPlatform::ShouldUseLayersAcceleration()
{
  const char *acceleratedEnv = PR_GetEnv("MOZ_ACCELERATED");
  if (gfxPrefs::LayersAccelerationDisabled() ||
      InSafeMode() ||
      (acceleratedEnv && *acceleratedEnv == '0'))
  {
    return false;
  }
  if (gfxPrefs::LayersAccelerationForceEnabled()) {
    return true;
  }
  if (AccelerateLayersByDefault()) {
    return true;
  }
  if (acceleratedEnv && *acceleratedEnv != '0') {
    return true;
  }
  return false;
}

bool
gfxPlatform::AccelerateLayersByDefault()
{
#if defined(MOZ_GL_PROVIDER) || defined(MOZ_WIDGET_UIKIT)
  return true;
#else
  return false;
#endif
}

bool
gfxPlatform::BufferRotationEnabled()
{
  MutexAutoLock autoLock(*gGfxPlatformPrefsLock);

  return sBufferRotationCheckPref && gfxPrefs::BufferRotationEnabled();
}

void
gfxPlatform::DisableBufferRotation()
{
  MutexAutoLock autoLock(*gGfxPlatformPrefsLock);

  sBufferRotationCheckPref = false;
}

already_AddRefed<ScaledFont>
gfxPlatform::GetScaledFontForFontWithCairoSkia(DrawTarget* aTarget, gfxFont* aFont)
{
    NativeFont nativeFont;
    if (aTarget->GetBackendType() == BackendType::CAIRO || aTarget->GetBackendType() == BackendType::SKIA) {
        nativeFont.mType = NativeFontType::CAIRO_FONT_FACE;
        nativeFont.mFont = aFont->GetCairoScaledFont();
        return Factory::CreateScaledFontForNativeFont(nativeFont, aFont->GetAdjustedSize());
    }

    return nullptr;
}

/* static */ bool
gfxPlatform::UsesOffMainThreadCompositing()
{
  InitLayersAccelerationPrefs();
  static bool firstTime = true;
  static bool result = false;

  if (firstTime) {
    result =
      sPrefBrowserTabsRemoteAutostart ||
      gfxPrefs::LayersOffMainThreadCompositionEnabled() ||
      gfxPrefs::LayersOffMainThreadCompositionForceEnabled() ||
      gfxPrefs::LayersOffMainThreadCompositionTestingEnabled();
#if defined(MOZ_WIDGET_GTK)
    // Linux users who chose OpenGL are being grandfathered in to OMTC
    result |= gfxPrefs::LayersAccelerationForceEnabled();

#endif
    firstTime = false;
  }

  return result;
}

/***
 * The preference "layout.frame_rate" has 3 meanings depending on the value:
 *
 * -1 = Auto (default), use hardware vsync or software vsync @ 60 hz if hw vsync fails.
 *  0 = ASAP mode - used during talos testing.
 *  X = Software vsync at a rate of X times per second.
 */
already_AddRefed<mozilla::gfx::VsyncSource>
gfxPlatform::CreateHardwareVsyncSource()
{
  NS_WARNING("Hardware Vsync support not yet implemented. Falling back to software timers");
  RefPtr<mozilla::gfx::VsyncSource> softwareVsync = new SoftwareVsyncSource();
  return softwareVsync.forget();
}

/* static */ bool
gfxPlatform::IsInLayoutAsapMode()
{
  // There are 2 modes of ASAP mode.
  // 1 is that the refresh driver and compositor are in lock step
  // the second is that the compositor goes ASAP and the refresh driver
  // goes at whatever the configurated rate is. This only checks the version
  // talos uses, which is the refresh driver and compositor are in lockstep.
  return Preferences::GetInt("layout.frame_rate", -1) == 0;
}

/* static */ bool
gfxPlatform::ForceSoftwareVsync()
{
  return Preferences::GetInt("layout.frame_rate", -1) > 0;
}

/* static */ int
gfxPlatform::GetSoftwareVsyncRate()
{
  int preferenceRate = Preferences::GetInt("layout.frame_rate",
                                           gfxPlatform::GetDefaultFrameRate());
  if (preferenceRate <= 0) {
    return gfxPlatform::GetDefaultFrameRate();
  }
  return preferenceRate;
}

/* static */ int
gfxPlatform::GetDefaultFrameRate()
{
  return 60;
}

static nsString
DetectBadApzWheelInputPrefs()
{
  static const char *sBadMultiplierPrefs[] = {
    "mousewheel.default.delta_multiplier_x",
    "mousewheel.with_alt.delta_multiplier_x",
    "mousewheel.with_control.delta_multiplier_x",
    "mousewheel.with_meta.delta_multiplier_x",
    "mousewheel.with_shift.delta_multiplier_x",
    "mousewheel.with_win.delta_multiplier_x",
    "mousewheel.with_alt.delta_multiplier_y",
    "mousewheel.with_control.delta_multiplier_y",
    "mousewheel.with_meta.delta_multiplier_y",
    "mousewheel.with_shift.delta_multiplier_y",
    "mousewheel.with_win.delta_multiplier_y",
  };

  nsString badPref;
  for (size_t i = 0; i < MOZ_ARRAY_LENGTH(sBadMultiplierPrefs); i++) {
    if (Preferences::GetInt(sBadMultiplierPrefs[i], 100) != 100) {
      badPref.AssignASCII(sBadMultiplierPrefs[i]);
      break;
    }
  }

  return badPref;
}

void
gfxPlatform::GetApzSupportInfo(mozilla::widget::InfoObject& aObj)
{
  if (!gfxPlatform::AsyncPanZoomEnabled()) {
    return;
  }

  if (SupportsApzWheelInput()) {
    nsString badPref = DetectBadApzWheelInputPrefs();

    aObj.DefineProperty("ApzWheelInput", 1);
    if (badPref.Length()) {
      aObj.DefineProperty("ApzWheelInputWarning", badPref);
    }
  }

  if (SupportsApzTouchInput()) {
    aObj.DefineProperty("ApzTouchInput", 1);
  }

  if (SupportsApzDragInput()) {
    aObj.DefineProperty("ApzDragInput", 1);
  }
}

/*static*/ bool
gfxPlatform::AsyncPanZoomEnabled()
{
#if !defined(MOZ_B2G) && !defined(MOZ_WIDGET_ANDROID) && !defined(MOZ_WIDGET_UIKIT)
  // For XUL applications (everything but B2G on mobile and desktop, and
  // Firefox on Android) we only want to use APZ when E10S is enabled. If
  // we ever get input events off the main thread we can consider relaxing
  // this requirement.
  if (!BrowserTabsRemoteAutostart()) {
    return false;
  }
#endif
  return gfxPrefs::AsyncPanZoomEnabledDoNotUseDirectly();
}

/*virtual*/ bool
gfxPlatform::UseProgressivePaint()
{
  return gfxPrefs::ProgressivePaintDoNotUseDirectly();
}

/*static*/ bool
gfxPlatform::PerfWarnings()
{
  return gfxPrefs::PerfWarnings();
}

static inline bool
AllowOpenGL(bool* aWhitelisted)
{
  nsCOMPtr<nsIGfxInfo> gfxInfo = do_GetService("@mozilla.org/gfx/info;1");
  if (gfxInfo) {
    // bug 655578: on X11 at least, we must always call GetData (even if we don't need that information)
    // as that's what causes GfxInfo initialization which kills the zombie 'glxtest' process.
    // initially we relied on the fact that GetFeatureStatus calls GetData for us, but bug 681026 showed
    // that assumption to be unsafe.
    gfxInfo->GetData();

    int32_t status;
    if (NS_SUCCEEDED(gfxInfo->GetFeatureStatus(nsIGfxInfo::FEATURE_OPENGL_LAYERS, &status))) {
      if (status == nsIGfxInfo::FEATURE_STATUS_OK) {
        *aWhitelisted = true;
        return true;
      }
    }
  }

  return gfxPrefs::LayersAccelerationForceEnabled();
}

void
gfxPlatform::GetAcceleratedCompositorBackends(nsTArray<LayersBackend>& aBackends)
{
  // Being whitelisted is not enough to accelerate, but not being whitelisted is
  // enough not to:
  bool whitelisted = false;

  if (AllowOpenGL(&whitelisted)) {
    aBackends.AppendElement(LayersBackend::LAYERS_OPENGL);
  }

  if (!whitelisted) {
    static int tell_me_once = 0;
    if (!tell_me_once) {
      NS_WARNING("OpenGL-accelerated layers are not supported on this system");
      tell_me_once = 1;
    }
#ifdef MOZ_WIDGET_ANDROID
    NS_RUNTIMEABORT("OpenGL-accelerated layers are a hard requirement on this platform. "
                    "Cannot continue without support for them");
#endif
  }
}

void
gfxPlatform::GetCompositorBackends(bool useAcceleration, nsTArray<mozilla::layers::LayersBackend>& aBackends)
{
  if (useAcceleration) {
    GetAcceleratedCompositorBackends(aBackends);
  }
  if (SupportsBasicCompositor()) {
    aBackends.AppendElement(LayersBackend::LAYERS_BASIC);
  }
}

void
gfxPlatform::NotifyCompositorCreated(LayersBackend aBackend)
{
  if (mCompositorBackend == aBackend) {
    return;
  }

  if (mCompositorBackend != LayersBackend::LAYERS_NONE) {
    gfxCriticalNote << "Compositors might be mixed ("
      << int(mCompositorBackend) << "," << int(aBackend) << ")";
  }

  // Set the backend before we notify so it's available immediately.
  mCompositorBackend = aBackend;

  // Notify that we created a compositor, so telemetry can update.
  NS_DispatchToMainThread(NS_NewRunnableFunction([] {
    if (nsCOMPtr<nsIObserverService> obsvc = services::GetObserverService()) {
      obsvc->NotifyObservers(nullptr, "compositor:created", nullptr);
    }
  }));
}

void
gfxPlatform::GetDeviceInitData(mozilla::gfx::DeviceInitData* aOut)
{
  MOZ_ASSERT(XRE_IsParentProcess());
  aOut->useAcceleration() = ShouldUseLayersAcceleration();
}

void
gfxPlatform::UpdateDeviceInitData()
{
  if (XRE_IsParentProcess()) {
    // The parent process figures out device initialization on its own.
    return;
  }

  mozilla::gfx::DeviceInitData data;
  mozilla::dom::ContentChild::GetSingleton()->SendGetGraphicsDeviceInitData(&data);

  SetDeviceInitData(data);
}

bool
gfxPlatform::SupportsApzDragInput() const
{
  return gfxPrefs::APZDragEnabled();
}
