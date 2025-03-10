/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SourceBuffer.h"

#include "AsyncEventRunner.h"
#include "MediaData.h"
#include "MediaSourceDemuxer.h"
#include "MediaSourceUtils.h"
#include "mozilla/ErrorResult.h"
#include "mozilla/FloatingPoint.h"
#include "mozilla/Preferences.h"
#include "mozilla/dom/MediaSourceBinding.h"
#include "mozilla/dom/TimeRanges.h"
#include "nsError.h"
#include "nsIEventTarget.h"
#include "nsIRunnable.h"
#include "nsThreadUtils.h"
#include "mozilla/Logging.h"
#include <time.h>
#include "TimeUnits.h"

struct JSContext;
class JSObject;

extern mozilla::LogModule* GetMediaSourceLog();
extern mozilla::LogModule* GetMediaSourceAPILog();

#define MSE_DEBUG(arg, ...) MOZ_LOG(GetMediaSourceLog(), mozilla::LogLevel::Debug, ("SourceBuffer(%p:%s)::%s: " arg, this, mType.get(), __func__, ##__VA_ARGS__))
#define MSE_DEBUGV(arg, ...) MOZ_LOG(GetMediaSourceLog(), mozilla::LogLevel::Verbose, ("SourceBuffer(%p:%s)::%s: " arg, this, mType.get(), __func__, ##__VA_ARGS__))
#define MSE_API(arg, ...) MOZ_LOG(GetMediaSourceAPILog(), mozilla::LogLevel::Debug, ("SourceBuffer(%p:%s)::%s: " arg, this, mType.get(), __func__, ##__VA_ARGS__))

namespace mozilla {

using media::TimeUnit;

namespace dom {

void
SourceBuffer::SetMode(SourceBufferAppendMode aMode, ErrorResult& aRv)
{
  typedef mozilla::SourceBufferContentManager::AppendState AppendState;

  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("SetMode(aMode=%d)", aMode);
  if (!IsAttached() || mUpdating) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  if (mAttributes->mGenerateTimestamps &&
      aMode == SourceBufferAppendMode::Segments) {
    aRv.Throw(NS_ERROR_DOM_TYPE_ERR);
    return;
  }
  MOZ_ASSERT(mMediaSource->ReadyState() != MediaSourceReadyState::Closed);
  if (mMediaSource->ReadyState() == MediaSourceReadyState::Ended) {
    mMediaSource->SetReadyState(MediaSourceReadyState::Open);
  }
  if (mContentManager->GetAppendState() == AppendState::PARSING_MEDIA_SEGMENT){
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }

  if (aMode == SourceBufferAppendMode::Sequence) {
    // Will set GroupStartTimestamp to GroupEndTimestamp.
    mContentManager->RestartGroupStartTimestamp();
  }

  mAttributes->SetAppendMode(aMode);
}

void
SourceBuffer::SetTimestampOffset(double aTimestampOffset, ErrorResult& aRv)
{
  typedef mozilla::SourceBufferContentManager::AppendState AppendState;

  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("SetTimestampOffset(aTimestampOffset=%f)", aTimestampOffset);
  if (!IsAttached() || mUpdating) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  MOZ_ASSERT(mMediaSource->ReadyState() != MediaSourceReadyState::Closed);
  if (mMediaSource->ReadyState() == MediaSourceReadyState::Ended) {
    mMediaSource->SetReadyState(MediaSourceReadyState::Open);
  }
  if (mContentManager->GetAppendState() == AppendState::PARSING_MEDIA_SEGMENT){
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  mAttributes->SetApparentTimestampOffset(aTimestampOffset);
  if (mAttributes->GetAppendMode() == SourceBufferAppendMode::Sequence) {
    mContentManager->SetGroupStartTimestamp(mAttributes->GetTimestampOffset());
  }
}

TimeRanges*
SourceBuffer::GetBuffered(ErrorResult& aRv)
{
  MOZ_ASSERT(NS_IsMainThread());
  // http://w3c.github.io/media-source/index.html#widl-SourceBuffer-buffered
  // 1. If this object has been removed from the sourceBuffers attribute of the parent media source then throw an InvalidStateError exception and abort these steps.
  if (!IsAttached()) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return nullptr;
  }
  bool rangeChanged = true;
  media::TimeIntervals intersection = mContentManager->Buffered();
  MSE_DEBUGV("intersection=%s", DumpTimeRanges(intersection).get());
  if (mBuffered) {
    media::TimeIntervals currentValue(mBuffered);
    rangeChanged = (intersection != currentValue);
    MSE_DEBUGV("currentValue=%s", DumpTimeRanges(currentValue).get());
  }
  // 5. If intersection ranges does not contain the exact same range information as the current value of this attribute, then update the current value of this attribute to intersection ranges.
  if (rangeChanged) {
    mBuffered = new TimeRanges(ToSupports(this));
    intersection.ToTimeRanges(mBuffered);
  }
  // 6. Return the current value of this attribute.
  return mBuffered;
}

media::TimeIntervals
SourceBuffer::GetTimeIntervals()
{
  return mContentManager->Buffered();
}

void
SourceBuffer::SetAppendWindowStart(double aAppendWindowStart, ErrorResult& aRv)
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("SetAppendWindowStart(aAppendWindowStart=%f)", aAppendWindowStart);
  if (!IsAttached() || mUpdating) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  if (aAppendWindowStart < 0 ||
      aAppendWindowStart >= mAttributes->GetAppendWindowEnd()) {
    aRv.Throw(NS_ERROR_DOM_TYPE_ERR);
    return;
  }
  mAttributes->SetAppendWindowStart(aAppendWindowStart);
}

void
SourceBuffer::SetAppendWindowEnd(double aAppendWindowEnd, ErrorResult& aRv)
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("SetAppendWindowEnd(aAppendWindowEnd=%f)", aAppendWindowEnd);
  if (!IsAttached() || mUpdating) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  if (IsNaN(aAppendWindowEnd) ||
      aAppendWindowEnd <= mAttributes->GetAppendWindowStart()) {
    aRv.Throw(NS_ERROR_DOM_TYPE_ERR);
    return;
  }
  mAttributes->SetAppendWindowEnd(aAppendWindowEnd);
}

void
SourceBuffer::AppendBuffer(const ArrayBuffer& aData, ErrorResult& aRv)
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("AppendBuffer(ArrayBuffer)");
  aData.ComputeLengthAndData();
  AppendData(aData.Data(), aData.Length(), aRv);
}

void
SourceBuffer::AppendBuffer(const ArrayBufferView& aData, ErrorResult& aRv)
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("AppendBuffer(ArrayBufferView)");
  aData.ComputeLengthAndData();
  AppendData(aData.Data(), aData.Length(), aRv);
}

void
SourceBuffer::Abort(ErrorResult& aRv)
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("Abort()");
  if (!IsAttached()) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  if (mMediaSource->ReadyState() != MediaSourceReadyState::Open) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  AbortBufferAppend();
  mContentManager->ResetParserState();
  mAttributes->SetAppendWindowStart(0);
  mAttributes->SetAppendWindowEnd(PositiveInfinity<double>());
}

void
SourceBuffer::AbortBufferAppend()
{
  if (mUpdating) {
    if (mPendingAppend.Exists()) {
      mPendingAppend.Disconnect();
      mContentManager->AbortAppendData();
      // Some data may have been added by the Segment Parser Loop.
      // Check if we need to update the duration.
      CheckEndTime();
    }
    AbortUpdating();
  }
}

void
SourceBuffer::Remove(double aStart, double aEnd, ErrorResult& aRv)
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("Remove(aStart=%f, aEnd=%f)", aStart, aEnd);
  if (!IsAttached()) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  if (mUpdating) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }
  if (IsNaN(mMediaSource->Duration()) ||
      aStart < 0 || aStart > mMediaSource->Duration() ||
      aEnd <= aStart || IsNaN(aEnd)) {
    aRv.Throw(NS_ERROR_DOM_TYPE_ERR);
    return;
  }
  if (mMediaSource->ReadyState() == MediaSourceReadyState::Ended) {
    mMediaSource->SetReadyState(MediaSourceReadyState::Open);
  }

  RangeRemoval(aStart, aEnd);
}

void
SourceBuffer::RangeRemoval(double aStart, double aEnd)
{
  StartUpdating();
  RefPtr<SourceBuffer> self = this;
  mContentManager->RangeRemoval(TimeUnit::FromSeconds(aStart),
                                TimeUnit::FromSeconds(aEnd))
    ->Then(AbstractThread::MainThread(), __func__,
           [self] (bool) { self->StopUpdating(); },
           []() { MOZ_ASSERT(false); });
}

void
SourceBuffer::Detach()
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_DEBUG("Detach");
  if (!mMediaSource) {
    MSE_DEBUG("Already detached");
    return;
  }
  AbortBufferAppend();
  if (mContentManager) {
     mContentManager->Detach();
     mMediaSource->GetDecoder()->GetDemuxer()->DetachSourceBuffer(
       static_cast<mozilla::TrackBuffersManager*>(mContentManager.get()));
  }
  mContentManager = nullptr;
  mMediaSource = nullptr;
}

void
SourceBuffer::Ended()
{
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(IsAttached());
  MSE_DEBUG("Ended");
  mContentManager->Ended();
  // We want the MediaSourceReader to refresh its buffered range as it may
  // have been modified (end lined up).
  mMediaSource->GetDecoder()->NotifyDataArrived();
}

SourceBuffer::SourceBuffer(MediaSource* aMediaSource, const nsACString& aType)
  : DOMEventTargetHelper(aMediaSource->GetParentObject())
  , mMediaSource(aMediaSource)
  , mUpdating(false)
  , mActive(false)
  , mType(aType)
{
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(aMediaSource);
  mEvictionThreshold = Preferences::GetUint("media.mediasource.eviction_threshold",
                                            100 * (1 << 20));
  bool generateTimestamps = false;
  if (aType.LowerCaseEqualsLiteral("audio/mpeg") ||
      aType.LowerCaseEqualsLiteral("audio/aac")) {
    generateTimestamps = true;
  }
  mAttributes = new SourceBufferAttributes(generateTimestamps);

  mContentManager =
    SourceBufferContentManager::CreateManager(mAttributes,
                                              aMediaSource->GetDecoder(),
                                              aType);
  MSE_DEBUG("Create mContentManager=%p",
            mContentManager.get());

  ErrorResult dummy;
  if (mAttributes->mGenerateTimestamps) {
    SetMode(SourceBufferAppendMode::Sequence, dummy);
  } else {
    SetMode(SourceBufferAppendMode::Segments, dummy);
  }
  mMediaSource->GetDecoder()->GetDemuxer()->AttachSourceBuffer(
    static_cast<mozilla::TrackBuffersManager*>(mContentManager.get()));
}

SourceBuffer::~SourceBuffer()
{
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(!mMediaSource);
  MSE_DEBUG("");
}

MediaSource*
SourceBuffer::GetParentObject() const
{
  return mMediaSource;
}

JSObject*
SourceBuffer::WrapObject(JSContext* aCx, JS::Handle<JSObject*> aGivenProto)
{
  return SourceBufferBinding::Wrap(aCx, this, aGivenProto);
}

void
SourceBuffer::DispatchSimpleEvent(const char* aName)
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_API("Dispatch event '%s'", aName);
  DispatchTrustedEvent(NS_ConvertUTF8toUTF16(aName));
}

void
SourceBuffer::QueueAsyncSimpleEvent(const char* aName)
{
  MSE_DEBUG("Queuing event '%s'", aName);
  nsCOMPtr<nsIRunnable> event = new AsyncEventRunner<SourceBuffer>(this, aName);
  NS_DispatchToMainThread(event, NS_DISPATCH_NORMAL);
}

void
SourceBuffer::StartUpdating()
{
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(!mUpdating);
  mUpdating = true;
  QueueAsyncSimpleEvent("updatestart");
}

void
SourceBuffer::StopUpdating()
{
  MOZ_ASSERT(NS_IsMainThread());
  if (!mUpdating) {
    // The buffer append or range removal algorithm  has been interrupted by
    // abort().
    return;
  }
  mUpdating = false;
  QueueAsyncSimpleEvent("update");
  QueueAsyncSimpleEvent("updateend");
}

void
SourceBuffer::AbortUpdating()
{
  MOZ_ASSERT(NS_IsMainThread());
  mUpdating = false;
  QueueAsyncSimpleEvent("abort");
  QueueAsyncSimpleEvent("updateend");
}

void
SourceBuffer::CheckEndTime()
{
  MOZ_ASSERT(NS_IsMainThread());
  // Check if we need to update mMediaSource duration
  double endTime = mContentManager->GroupEndTimestamp().ToSeconds();
  double duration = mMediaSource->Duration();
  if (endTime > duration) {
    mMediaSource->SetDuration(endTime, MSRangeRemovalAction::SKIP);
  }
}

void
SourceBuffer::AppendData(const uint8_t* aData, uint32_t aLength, ErrorResult& aRv)
{
  MSE_DEBUG("AppendData(aLength=%u)", aLength);

  RefPtr<MediaByteBuffer> data = PrepareAppend(aData, aLength, aRv);
  if (!data) {
    return;
  }
  mContentManager->AppendData(data, mAttributes->GetTimestampOffset());

  StartUpdating();

  BufferAppend();
}

void
SourceBuffer::BufferAppend()
{
  MOZ_ASSERT(mUpdating);
  MOZ_ASSERT(mMediaSource);
  MOZ_ASSERT(!mPendingAppend.Exists());

  mPendingAppend.Begin(mContentManager->BufferAppend()
                       ->Then(AbstractThread::MainThread(), __func__, this,
                              &SourceBuffer::AppendDataCompletedWithSuccess,
                              &SourceBuffer::AppendDataErrored));
}

void
SourceBuffer::AppendDataCompletedWithSuccess(bool aHasActiveTracks)
{
  MOZ_ASSERT(mUpdating);
  mPendingAppend.Complete();

  if (aHasActiveTracks) {
    if (!mActive) {
      mActive = true;
      mMediaSource->SourceBufferIsActive(this);
    }
  }
  if (mActive) {
    // Tell our parent decoder that we have received new data.
    mMediaSource->GetDecoder()->NotifyDataArrived();
    // Send progress event.
    mMediaSource->GetDecoder()->NotifyBytesDownloaded();
  }

  CheckEndTime();

  StopUpdating();
}

void
SourceBuffer::AppendDataErrored(nsresult aError)
{
  MOZ_ASSERT(mUpdating);
  mPendingAppend.Complete();

  switch (aError) {
    case NS_ERROR_ABORT:
      // Nothing further to do as the trackbuffer has been shutdown.
      // or append was aborted and abort() has handled all the events.
      break;
    default:
      AppendError(true);
      break;
  }
}

void
SourceBuffer::AppendError(bool aDecoderError)
{
  MOZ_ASSERT(NS_IsMainThread());

  mContentManager->ResetParserState();

  mUpdating = false;

  QueueAsyncSimpleEvent("error");
  QueueAsyncSimpleEvent("updateend");

  if (aDecoderError) {
    Optional<MediaSourceEndOfStreamError> decodeError(
      MediaSourceEndOfStreamError::Decode);
    ErrorResult dummy;
    mMediaSource->EndOfStream(decodeError, dummy);
  }
}

already_AddRefed<MediaByteBuffer>
SourceBuffer::PrepareAppend(const uint8_t* aData, uint32_t aLength, ErrorResult& aRv)
{
  typedef SourceBufferContentManager::EvictDataResult Result;

  if (!IsAttached() || mUpdating) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return nullptr;
  }

  // If the HTMLMediaElement.error attribute is not null, then throw an
  // InvalidStateError exception and abort these steps.
  if (!mMediaSource->GetDecoder() ||
      mMediaSource->GetDecoder()->IsEndedOrShutdown()) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return nullptr;
  }

  if (mMediaSource->ReadyState() == MediaSourceReadyState::Ended) {
    mMediaSource->SetReadyState(MediaSourceReadyState::Open);
  }

  // Eviction uses a byte threshold. If the buffer is greater than the
  // number of bytes then data is evicted. The time range for this
  // eviction is reported back to the media source. It will then
  // evict data before that range across all SourceBuffers it knows
  // about.
  // TODO: Make the eviction threshold smaller for audio-only streams.
  // TODO: Drive evictions off memory pressure notifications.
  // TODO: Consider a global eviction threshold  rather than per TrackBuffer.
  TimeUnit newBufferStartTime;
  // Attempt to evict the amount of data we are about to add by lowering the
  // threshold.
  uint32_t toEvict =
    (mEvictionThreshold > aLength) ? mEvictionThreshold - aLength : aLength;
  Result evicted =
    mContentManager->EvictData(TimeUnit::FromSeconds(mMediaSource->GetDecoder()->GetCurrentTime()),
                               toEvict, &newBufferStartTime);
  if (evicted == Result::DATA_EVICTED) {
    MSE_DEBUG("AppendData Evict; current buffered start=%f",
              GetBufferedStart());

    // We notify that we've evicted from the time range 0 through to
    // the current start point.
    mMediaSource->NotifyEvicted(0.0, newBufferStartTime.ToSeconds());
  }

  // See if we have enough free space to append our new data.
  // As we can only evict once we have playable data, we must give a chance
  // to the DASH player to provide a complete media segment.
  if (aLength > mEvictionThreshold || evicted == Result::BUFFER_FULL) {
    aRv.Throw(NS_ERROR_DOM_QUOTA_EXCEEDED_ERR);
    return nullptr;
  }

  RefPtr<MediaByteBuffer> data = new MediaByteBuffer();
  if (!data->AppendElements(aData, aLength, fallible)) {
    aRv.Throw(NS_ERROR_DOM_QUOTA_EXCEEDED_ERR);
    return nullptr;
  }
  return data.forget();
}

double
SourceBuffer::GetBufferedStart()
{
  MOZ_ASSERT(NS_IsMainThread());
  ErrorResult dummy;
  RefPtr<TimeRanges> ranges = GetBuffered(dummy);
  return ranges->Length() > 0 ? ranges->GetStartTime() : 0;
}

double
SourceBuffer::GetBufferedEnd()
{
  MOZ_ASSERT(NS_IsMainThread());
  ErrorResult dummy;
  RefPtr<TimeRanges> ranges = GetBuffered(dummy);
  return ranges->Length() > 0 ? ranges->GetEndTime() : 0;
}

void
SourceBuffer::Evict(double aStart, double aEnd)
{
  MOZ_ASSERT(NS_IsMainThread());
  MSE_DEBUG("Evict(aStart=%f, aEnd=%f)", aStart, aEnd);
  double currentTime = mMediaSource->GetDecoder()->GetCurrentTime();
  double evictTime = aEnd;
  const double safety_threshold = 5;
  if (currentTime + safety_threshold >= evictTime) {
    evictTime -= safety_threshold;
  }
  mContentManager->EvictBefore(TimeUnit::FromSeconds(evictTime));
}

NS_IMPL_CYCLE_COLLECTION_CLASS(SourceBuffer)

NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN(SourceBuffer)
  // Tell the TrackBuffer to end its current SourceBufferResource.
  SourceBufferContentManager* manager = tmp->mContentManager;
  if (manager) {
    manager->Detach();
  }
  NS_IMPL_CYCLE_COLLECTION_UNLINK(mMediaSource)
  NS_IMPL_CYCLE_COLLECTION_UNLINK(mBuffered)
NS_IMPL_CYCLE_COLLECTION_UNLINK_END_INHERITED(DOMEventTargetHelper)

NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INHERITED(SourceBuffer,
                                                  DOMEventTargetHelper)
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE(mMediaSource)
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE(mBuffered)
NS_IMPL_CYCLE_COLLECTION_TRAVERSE_END

NS_IMPL_ADDREF_INHERITED(SourceBuffer, DOMEventTargetHelper)
NS_IMPL_RELEASE_INHERITED(SourceBuffer, DOMEventTargetHelper)

NS_INTERFACE_MAP_BEGIN_CYCLE_COLLECTION_INHERITED(SourceBuffer)
NS_INTERFACE_MAP_END_INHERITING(DOMEventTargetHelper)

#undef MSE_DEBUG
#undef MSE_DEBUGV
#undef MSE_API

} // namespace dom

} // namespace mozilla
