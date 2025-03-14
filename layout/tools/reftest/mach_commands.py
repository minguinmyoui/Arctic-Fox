# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from __future__ import absolute_import, unicode_literals

import mozpack.path as mozpath
import os
import re
import sys
import warnings
import which

from mozbuild.base import (
    MachCommandBase,
    MachCommandConditions as conditions,
    MozbuildObject,
)

from mach.decorators import (
    CommandArgument,
    CommandProvider,
    Command,
)

import reftestcommandline

ADB_NOT_FOUND = '''
The %s command requires the adb binary to be on your path.

If you have a B2G build, this can be found in
'%s/out/host/<platform>/bin'.
'''.lstrip()

GAIA_PROFILE_NOT_FOUND = '''
The %s command requires a non-debug gaia profile. Either pass in --profile,
or set the GAIA_PROFILE environment variable.

If you do not have a non-debug gaia profile, you can build one:
    $ git clone https://github.com/mozilla-b2g/gaia
    $ cd gaia
    $ make

The profile should be generated in a directory called 'profile'.
'''.lstrip()

GAIA_PROFILE_IS_DEBUG = '''
The %s command requires a non-debug gaia profile. The specified profile,
%s, is a debug profile.

If you do not have a non-debug gaia profile, you can build one:
    $ git clone https://github.com/mozilla-b2g/gaia
    $ cd gaia
    $ make

The profile should be generated in a directory called 'profile'.
'''.lstrip()

MARIONETTE_DISABLED = '''
The %s command requires a marionette enabled build.

Add 'ENABLE_MARIONETTE=1' to your mozconfig file and re-build the application.
Your currently active mozconfig is %s.
'''.lstrip()

class ReftestRunner(MozbuildObject):
    """Easily run reftests.

    This currently contains just the basics for running reftests. We may want
    to hook up result parsing, etc.
    """
    def __init__(self, *args, **kwargs):
        MozbuildObject.__init__(self, *args, **kwargs)

        # TODO Bug 794506 remove once mach integrates with virtualenv.
        build_path = os.path.join(self.topobjdir, 'build')
        if build_path not in sys.path:
            sys.path.append(build_path)

        self.tests_dir = os.path.join(self.topobjdir, '_tests')
        self.reftest_dir = os.path.join(self.tests_dir, 'reftest')

    def _make_shell_string(self, s):
        return "'%s'" % re.sub("'", r"'\''", s)

    def run_b2g_test(self, b2g_home=None, xre_path=None, **kwargs):
        """Runs a b2g reftest.

        filter is a regular expression (in JS syntax, as could be passed to the
        RegExp constructor) to select which reftests to run from the manifest.

        test_file is a path to a test file. It can be a relative path from the
        top source directory, an absolute filename, or a directory containing
        test files.

        suite is the type of reftest to run. It can be one of ('reftest',
        'crashtest').
        """
        if kwargs["suite"] not in ('reftest', 'crashtest'):
            raise Exception('None or unrecognized reftest suite type.')

        sys.path.insert(0, self.reftest_dir)

        test_subdir = {"reftest": os.path.join('layout', 'reftests'),
                       "crashtest": os.path.join('layout', 'crashtest')}[kwargs["suite"]]

        # Find the manifest file
        if not kwargs["tests"]:
            if not os.path.exists(os.path.join(self.topsrcdir, test_subdir)):
                test_file = mozpath.relpath(os.path.abspath(test_subdir),
                                            self.topsrcdir)
            kwargs["tests"] = [test_subdir]

        tests = os.path.join(self.reftest_dir, 'tests')
        if not os.path.isdir(tests):
            os.symlink(self.topsrcdir, tests)

        for i, path in enumerate(kwargs["tests"]):
            # Non-absolute paths are relative to the packaged directory, which
            # has an extra tests/ at the start
            if os.path.exists(os.path.abspath(path)):
                path = os.path.relpath(path, os.path.join(self.topsrcdir))
            kwargs["tests"][i] = os.path.join('tests', path)

        if conditions.is_b2g_desktop(self):
            return self.run_b2g_desktop(**kwargs)

        return self.run_b2g_remote(b2g_home, xre_path, **kwargs)

    def run_b2g_desktop(self, **kwargs):
        if self.substs.get('ENABLE_MARIONETTE') != '1':
            print(MARIONETTE_DISABLED % ('mochitest-b2g-desktop',
                                         self.mozconfig['path']))
            return 1

        if not kwargs["profile"]:
            gaia_profile = os.environ.get('GAIA_PROFILE')
            if not gaia_profile:
                print(GAIA_PROFILE_NOT_FOUND % 'reftest-b2g-desktop')
                return 1
            kwargs["profile"] = gaia_profile


        if os.path.isfile(os.path.join(kwargs["profile"], 'extensions',
                                       'httpd@gaiamobile.org')):
            print(GAIA_PROFILE_IS_DEBUG % ('mochitest-b2g-desktop',
                                           kwargs["profile"]))
            return 1

        kwargs["desktop"] = True
        kwargs["app"] = self.get_binary_path()
        if kwargs["oop"]:
            options.browser_arg = '-oop'
        if not kwargs["app"].endswith('-bin'):
            kwargs["app"] = '%s-bin' % options.app
        if not os.path.isfile(kwargs["app"]):
            options.app = kwargs["app"][:-len('-bin')]

        return runreftestb2g.run(**kwargs)

    def run_b2g_remote(self, b2g_home, xre_path, **kwargs):
        import runreftestb2g

        try:
            which.which('adb')
        except which.WhichError:
            # TODO Find adb automatically if it isn't on the path
            raise Exception(ADB_NOT_FOUND % ('%s-remote' % kwargs["suite"], b2g_home))

        kwargs["b2gPath"] = b2g_home
        kwargs["logdir"] = self.reftest_dir
        kwargs["httpdPath"] = os.path.join(self.topsrcdir, 'netwerk', 'test', 'httpserver')
        kwargs["xrePath"] = xre_path
        kwargs["ignoreWindowSize"] = True

        # Don't enable oop for crashtest until they run oop in automation
        if kwargs["suite"] == 'reftest':
            kwargs["oop"] = True

        return runreftestb2g.run_remote(**kwargs)

    def run_desktop_test(self, **kwargs):
        """Runs a reftest."""
        import runreftest

        if kwargs["suite"] not in ('reftest', 'crashtest', 'jstestbrowser'):
            raise Exception('None or unrecognized reftest suite type.')

        default_manifest = {
            "reftest": (self.topsrcdir, "layout", "reftests", "reftest.list"),
            "crashtest": (self.topsrcdir, "testing", "crashtest", "crashtests.list"),
            "jstestbrowser": (self.topobjdir, "dist", "test-stage", "jsreftest", "tests",
                              "jstests.list")
        }

        kwargs["extraProfileFiles"] = [os.path.join(self.topobjdir, "dist", "plugins")]
        kwargs["symbolsPath"] = os.path.join(self.topobjdir, "crashreporter-symbols")

        if not kwargs["tests"]:
            kwargs["tests"] = [os.path.join(*default_manifest[kwargs["suite"]])]

        if kwargs["suite"] == "jstestbrowser":
            kwargs["extraProfileFiles"].append(os.path.join(self.topobjdir, "dist",
                                                            "test-stage", "jsreftest",
                                                            "tests", "user.js"))

        if not kwargs["runTestsInParallel"]:
            kwargs["logFile"] = "%s.log" % kwargs["suite"]

        #Remove the stdout handler from the internal logger and let mach deal with it
        runreftest.log.removeHandler(runreftest.log.handlers[0])
        self.log_manager.enable_unstructured()
        rv = runreftest.run(**kwargs)
        self.log_manager.disable_unstructured()

        return rv

@CommandProvider
class MachCommands(MachCommandBase):
    @Command('reftest',
             category='testing',
             description='Run reftests (layout and graphics correctness).',
             parser=reftestcommandline.DesktopArgumentsParser)
    def run_reftest(self, **kwargs):
        kwargs["suite"] = "reftest"
        return self._run_reftest(**kwargs)

    @Command('jstestbrowser',
             category='testing',
             description='Run js/src/tests in the browser.',
             parser=reftestcommandline.DesktopArgumentsParser)
    def run_jstestbrowser(self, **kwargs):
        self._mach_context.commands.dispatch("build",
                                             self._mach_context,
                                             what=["stage-jstests"])
        kwargs["suite"] = "jstestbrowser"
        return self._run_reftest(**kwargs)

    @Command('reftest-ipc',
             category='testing',
             description='Run IPC reftests (layout and graphics correctness, separate process).',
             parser=reftestcommandline.DesktopArgumentsParser)
    def run_ipc(self, **kwargs):
        kwargs["ipc"] = True
        kwargs["suite"] = "reftest"
        return self._run_reftest(**kwargs)

    @Command('crashtest',
             category='testing',
             description='Run crashtests (Check if crashes on a page).',
             parser=reftestcommandline.DesktopArgumentsParser)
    def run_crashtest(self, **kwargs):
        kwargs["suite"] = "crashtest"
        return self._run_reftest(**kwargs)

    @Command('crashtest-ipc',
             category='testing',
             description='Run IPC crashtests (Check if crashes on a page, separate process).',
             parser=reftestcommandline.DesktopArgumentsParser)
    def run_crashtest_ipc(self, **kwargs):
        kwargs["ipc"] = True
        kwargs["suite"] = "crashtest"
        return self._run_reftest(**kwargs)

    def _run_reftest(self, **kwargs):
        reftest = self._spawn(ReftestRunner)
        return reftest.run_desktop_test(**kwargs)


# TODO For now b2g commands will only work with the emulator,
# they should be modified to work with all devices.
def is_emulator(cls):
    """Emulator needs to be configured."""
    return cls.device_name.startswith('emulator')


@CommandProvider
class B2GCommands(MachCommandBase):
    def __init__(self, context):
        MachCommandBase.__init__(self, context)

        for attr in ('b2g_home', 'xre_path', 'device_name'):
            setattr(self, attr, getattr(context, attr, None))

    @Command('reftest-remote', category='testing',
             description='Run a remote reftest (b2g layout and graphics correctness, remote device).',
             conditions=[conditions.is_b2g, is_emulator],
             parser=reftestcommandline.B2GArgumentParser)
    def run_reftest_remote(self, **kwargs):
        kwargs["suite"] = "reftest"
        return self._run_reftest(**kwargs)

    @Command('reftest-b2g-desktop', category='testing',
             description='Run a b2g desktop reftest (b2g desktop layout and graphics correctness).',
             conditions=[conditions.is_b2g_desktop],
             parser=reftestcommandline.B2GArgumentParser)
    def run_reftest_b2g_desktop(self, **kwargs):
        kwargs["suite"] = "reftest"
        return self._run_reftest(**kwargs)

    @Command('crashtest-remote', category='testing',
             description='Run a remote crashtest (Check if b2g crashes on a page, remote device).',
             conditions=[conditions.is_b2g, is_emulator],
             parser=reftestcommandline.B2GArgumentParser)
    def run_crashtest_remote(self, test_file, **kwargs):
        kwargs["suite"] = "crashtest"
        return self._run_reftest(**kwargs)

    def _run_reftest(self, **kwargs):
        if self.device_name:
            if self.device_name.startswith('emulator'):
                emulator = 'arm'
                if 'x86' in self.device_name:
                    emulator = 'x86'
                kwargs['emulator'] = emulator

        reftest = self._spawn(ReftestRunner)
        return reftest.run_b2g_test(self.b2g_home, self.xre_path, **kwargs)
