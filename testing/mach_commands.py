# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from __future__ import absolute_import, print_function, unicode_literals

import json
import os
import sys
import tempfile

from mach.decorators import (
    CommandArgument,
    CommandProvider,
    Command,
)

from mozbuild.base import MachCommandBase
from mozbuild.base import MachCommandConditions as conditions
from argparse import ArgumentParser


UNKNOWN_TEST = '''
I was unable to find tests in the argument(s) given.

You need to specify a test directory, filename, test suite name, or
abbreviation.

It's possible my little brain doesn't know about the type of test you are
trying to execute. If you suspect this, please request support by filing
a bug at
https://bugzilla.mozilla.org/enter_bug.cgi?product=Testing&component=General.
'''.strip()

UNKNOWN_FLAVOR = '''
I know you are trying to run a %s test. Unfortunately, I can't run those
tests yet. Sorry!
'''.strip()

MOCHITEST_CHUNK_BY_DIR = 4
MOCHITEST_TOTAL_CHUNKS = 5

TEST_SUITES = {
    'cppunittest': {
        'aliases': ('Cpp', 'cpp'),
        'mach_command': 'cppunittest',
        'kwargs': {'test_file': None},
    },
    'crashtest': {
        'aliases': ('C', 'Rc', 'RC', 'rc'),
        'mach_command': 'crashtest',
        'kwargs': {'test_file': None},
    },
    'crashtest-ipc': {
        'aliases': ('Cipc', 'cipc'),
        'mach_command': 'crashtest-ipc',
        'kwargs': {'test_file': None},
    },
    'jetpack': {
        'aliases': ('J',),
        'mach_command': 'jetpack-test',
        'kwargs': {},
    },
    'check-spidermonkey': {
        'aliases': ('Sm', 'sm'),
        'mach_command': 'check-spidermonkey',
        'kwargs': {'valgrind': False},
    },
    'mochitest-a11y': {
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'a11y', 'test_paths': None},
    },
    'mochitest-browser': {
        'aliases': ('bc', 'BC', 'Bc'),
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'browser-chrome', 'test_paths': None},
    },
    'mochitest-chrome': {
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'chrome', 'test_paths': None},
    },
    'mochitest-devtools': {
        'aliases': ('dt', 'DT', 'Dt'),
        'mach_command': 'mochitest',
        'kwargs': {'subsuite': 'devtools', 'test_paths': None},
    },
    'mochitest-ipcplugins': {
        'make_target': 'mochitest-ipcplugins',
    },
    'mochitest-plain': {
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'plain', 'test_paths': None},
    },
    'luciddream': {
        'mach_command': 'luciddream',
        'kwargs': {'test_paths': None},
    },
    'reftest': {
        'aliases': ('RR', 'rr', 'Rr'),
        'mach_command': 'reftest',
        'kwargs': {'test_file': None},
    },
    'reftest-ipc': {
        'aliases': ('Ripc',),
        'mach_command': 'reftest-ipc',
        'kwargs': {'test_file': None},
    },
    'web-platform-tests': {
        'aliases': ('wpt',),
        'mach_command': 'web-platform-tests',
        'kwargs': {}
    },
    'valgrind': {
        'aliases': ('V', 'v'),
        'mach_command': 'valgrind-test',
        'kwargs': {},
    },
    'xpcshell': {
        'aliases': ('X', 'x'),
        'mach_command': 'xpcshell-test',
        'kwargs': {'test_file': 'all'},
    },
}

# Maps test flavors to metadata on how to run that test.
TEST_FLAVORS = {
    'a11y': {
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'a11y', 'test_paths': []},
    },
    'browser-chrome': {
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'browser-chrome', 'test_paths': []},
    },
    'chrashtest': { },
    'chrome': {
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'chrome', 'test_paths': []},
    },
    'mochitest': {
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'mochitest', 'test_paths': []},
    },
    'reftest': { },
    'steeplechase': { },
    'web-platform-tests': {
        'mach_command': 'web-platform-tests',
        'kwargs': {'include': []}
    },
    'webapprt-chrome': {
        'mach_command': 'mochitest',
        'kwargs': {'flavor': 'webapprt-chrome', 'test_paths': []},
    },
    'xpcshell': {
        'mach_command': 'xpcshell-test',
        'kwargs': {'test_paths': []},
    },
}


for i in range(1, MOCHITEST_TOTAL_CHUNKS + 1):
    TEST_SUITES['mochitest-%d' %i] = {
        'aliases': ('M%d' % i, 'm%d' % i),
        'mach_command': 'mochitest',
        'kwargs': {
            'flavor': 'mochitest',
            'subsuite': 'default',
            'chunk_by_dir': MOCHITEST_CHUNK_BY_DIR,
            'total_chunks': MOCHITEST_TOTAL_CHUNKS,
            'this_chunk': i,
            'test_paths': None,
        },
    }

TEST_HELP = '''
Test or tests to run. Tests can be specified by filename, directory, suite
name or suite alias.

The following test suites and aliases are supported: %s
''' % ', '.join(sorted(TEST_SUITES))
TEST_HELP = TEST_HELP.strip()


@CommandProvider
class Test(MachCommandBase):
    @Command('test', category='testing', description='Run tests (detects the kind of test and runs it).')
    @CommandArgument('what', default=None, nargs='*', help=TEST_HELP)
    def test(self, what):
        """Run tests from names or paths.

        mach test accepts arguments specifying which tests to run. Each argument
        can be:

        * The path to a test file
        * A directory containing tests
        * A test suite name
        * An alias to a test suite name (codes used on TreeHerder)

        When paths or directories are given, they are first resolved to test
        files known to the build system.

        If resolved tests belong to more than one test type/flavor/harness,
        the harness for each relevant type/flavor will be invoked. e.g. if
        you specify a directory with xpcshell and browser chrome mochitests,
        both harnesses will be invoked.
        """
        from mozbuild.testing import TestResolver

        # Parse arguments and assemble a test "plan."
        run_suites = set()
        run_tests = []
        resolver = self._spawn(TestResolver)

        for entry in what:
            # If the path matches the name or alias of an entire suite, run
            # the entire suite.
            if entry in TEST_SUITES:
                run_suites.add(entry)
                continue
            suitefound = False
            for suite, v in TEST_SUITES.items():
                if entry in v.get('aliases', []):
                    run_suites.add(suite)
                    suitefound = True
            if suitefound:
                continue

            # Now look for file/directory matches in the TestResolver.
            relpath = self._wrap_path_argument(entry).relpath()
            tests = list(resolver.resolve_tests(paths=[relpath]))
            run_tests.extend(tests)

            if not tests:
                print('UNKNOWN TEST: %s' % entry, file=sys.stderr)

        if not run_suites and not run_tests:
            print(UNKNOWN_TEST)
            return 1

        status = None
        for suite_name in run_suites:
            suite = TEST_SUITES[suite_name]

            if 'mach_command' in suite:
                res = self._mach_context.commands.dispatch(
                    suite['mach_command'], self._mach_context,
                    **suite['kwargs'])
                if res:
                    status = res

            elif 'make_target' in suite:
                res = self._run_make(target=suite['make_target'],
                    pass_thru=True)
                if res:
                    status = res

        buckets = {}
        for test in run_tests:
            key = (test['flavor'], test['subsuite'])
            buckets.setdefault(key, []).append(test)

        for (flavor, subsuite), tests in sorted(buckets.items()):
            if flavor not in TEST_FLAVORS:
                print(UNKNOWN_FLAVOR % flavor)
                status = 1
                continue

            m = TEST_FLAVORS[flavor]
            if 'mach_command' not in m:
                print(UNKNOWN_FLAVOR % flavor)
                status = 1
                continue

            kwargs = dict(m['kwargs'])
            kwargs['subsuite'] = subsuite

            res = self._mach_context.commands.dispatch(
                    m['mach_command'], self._mach_context,
                    test_objects=tests, **kwargs)
            if res:
                status = res

        return status


@CommandProvider
class MachCommands(MachCommandBase):
    @Command('cppunittest', category='testing',
        description='Run cpp unit tests (C++ tests).')
    @CommandArgument('test_files', nargs='*', metavar='N',
        help='Test to run. Can be specified as one or more files or ' \
            'directories, or omitted. If omitted, the entire test suite is ' \
            'executed.')

    def run_cppunit_test(self, **params):
        import mozinfo
        from mozlog import commandline
        log = commandline.setup_logging("cppunittest",
                                        {},
                                        {"tbpl": sys.stdout})

        # See if we have crash symbols
        symbols_path = os.path.join(self.distdir, 'crashreporter-symbols')
        if not os.path.isdir(symbols_path):
            symbols_path = None

        # If no tests specified, run all tests in main manifest
        tests = params['test_files']
        if len(tests) == 0:
            tests = [os.path.join(self.distdir, 'cppunittests')]
            manifest_path = os.path.join(self.topsrcdir, 'testing', 'cppunittest.ini')
        else:
            manifest_path = None

        if conditions.is_android(self):
            from mozrunner.devices.android_device import verify_android_device
            verify_android_device(self, install=False)
            return self.run_android_test(tests, symbols_path, manifest_path, log)

        return self.run_desktop_test(tests, symbols_path, manifest_path, log)

    def run_desktop_test(self, tests, symbols_path, manifest_path, log):
        import runcppunittests as cppunittests
        from mozlog import commandline

        parser = cppunittests.CPPUnittestOptions()
        commandline.add_logging_group(parser)
        options, args = parser.parse_args()

        options.symbols_path = symbols_path
        options.manifest_path = manifest_path
        options.xre_path = self.bindir

        try:
            result = cppunittests.run_test_harness(options, tests)
        except Exception as e:
            log.error("Caught exception running cpp unit tests: %s" % str(e))
            result = False
            raise

        return 0 if result else 1

    def run_android_test(self, tests, symbols_path, manifest_path, log):
        import remotecppunittests as remotecppunittests
        from mozlog import commandline

        parser = remotecppunittests.RemoteCPPUnittestOptions()
        commandline.add_logging_group(parser)
        options, args = parser.parse_args()

        options.symbols_path = symbols_path
        options.manifest_path = manifest_path
        options.xre_path = self.bindir
        options.dm_trans = "adb"
        options.local_lib = self.bindir.replace('bin', 'fennec')
        for file in os.listdir(os.path.join(self.topobjdir, "dist")):
            if file.endswith(".apk") and file.startswith("fennec"):
                options.local_apk = os.path.join(self.topobjdir, "dist", file)
                log.info("using APK: " + options.local_apk)
                break

        try:
            result = remotecppunittests.run_test_harness(options, tests)
        except Exception as e:
            log.error("Caught exception running cpp unit tests: %s" % str(e))
            result = False
            raise

        return 0 if result else 1

def executable_name(name):
    return name + '.exe' if sys.platform.startswith('win') else name

@CommandProvider
class CheckSpiderMonkeyCommand(MachCommandBase):
    @Command('check-spidermonkey', category='testing', description='Run SpiderMonkey tests (JavaScript engine).')
    @CommandArgument('--valgrind', action='store_true', help='Run jit-test suite with valgrind flag')

    def run_checkspidermonkey(self, **params):
        import subprocess
        import sys

        js = os.path.join(self.bindir, executable_name('js'))

        print('Running jit-tests')
        jittest_cmd = [os.path.join(self.topsrcdir, 'js', 'src', 'jit-test', 'jit_test.py'),
              js, '--no-slow', '--jitflags=all']
        if params['valgrind']:
            jittest_cmd.append('--valgrind')

        jittest_result = subprocess.call(jittest_cmd)

        print('running jstests')
        jstest_cmd = [os.path.join(self.topsrcdir, 'js', 'src', 'tests', 'jstests.py'),
              js, '--jitflags=all']
        jstest_result = subprocess.call(jstest_cmd)

        print('running jsapi-tests')
        jsapi_tests_cmd = [os.path.join(self.bindir, executable_name('jsapi-tests'))]
        jsapi_tests_result = subprocess.call(jsapi_tests_cmd)

        print('running check-style')
        check_style_cmd = [sys.executable, os.path.join(self.topsrcdir, 'config', 'check_spidermonkey_style.py')]
        check_style_result = subprocess.call(check_style_cmd, cwd=os.path.join(self.topsrcdir, 'js', 'src'))

        print('running check-masm')
        check_masm_cmd = [sys.executable, os.path.join(self.topsrcdir, 'config', 'check_macroassembler_style.py')]
        check_masm_result = subprocess.call(check_masm_cmd, cwd=os.path.join(self.topsrcdir, 'js', 'src'))

        all_passed = jittest_result and jstest_result and jsapi_tests_result and check_style_result and check_masm_result

        return all_passed

@CommandProvider
class JsapiTestsCommand(MachCommandBase):
    @Command('jsapi-tests', category='testing', description='Run jsapi tests (JavaScript engine).')
    @CommandArgument('test_name', nargs='?', metavar='N',
        help='Test to run. Can be a prefix or omitted. If omitted, the entire ' \
             'test suite is executed.')

    def run_jsapitests(self, **params):
        import subprocess

        bin_suffix = ''
        if sys.platform.startswith('win'):
            bin_suffix = '.exe'

        print('running jsapi-tests')
        jsapi_tests_cmd = [os.path.join(self.bindir, executable_name('jsapi-tests'))]
        if params['test_name']:
            jsapi_tests_cmd.append(params['test_name'])

        jsapi_tests_result = subprocess.call(jsapi_tests_cmd)

        return jsapi_tests_result


@CommandProvider
class PushToTry(MachCommandBase):

    def validate_args(self, paths, tests, tags, builds, platforms):
        if not any([len(paths), tests, tags]):
            print("Paths, tests, or tags must be specified.")
            sys.exit(1)

        if platforms is None:
            platforms = os.environ['AUTOTRY_PLATFORM_HINT']

        for p in paths:
            p = os.path.normpath(os.path.abspath(p))
            if not p.startswith(self.topsrcdir):
                print('Specified path "%s" is outside of the srcdir, unable to'
                      ' specify tests outside of the srcdir' % p)
                sys.exit(1)
            if len(p) <= len(self.topsrcdir):
                print('Specified path "%s" is at the top of the srcdir and would'
                      ' select all tests.' % p)
                sys.exit(1)

        return builds, platforms

    @Command('try', category='testing', description='Push selected tests to the try server')
    @CommandArgument('paths', nargs='*', help='Paths to search for tests to run on try.')
    @CommandArgument('-n', dest='verbose', action='store_true', default=False,
                     help='Print detailed information about the resulting test selection '
                          'and commands performed.')
    @CommandArgument('-p', dest='platforms', required='AUTOTRY_PLATFORM_HINT' not in os.environ,
                     help='Platforms to run. (required if not found in the environment)')
    @CommandArgument('-u', dest='tests',
                     help='Test jobs to run. These will be used in place of suites '
                          'determined by test paths, if any.')
    @CommandArgument('--extra', dest='extra_tests',
                     help='Additional tests to run. These will be added to suites '
                          'determined by test paths, if any.')
    @CommandArgument('-b', dest='builds', default='do',
                     help='Build types to run (d for debug, o for optimized)')
    @CommandArgument('--tag', dest='tags', action='append',
                     help='Restrict tests to the given tag (may be specified multiple times)')
    @CommandArgument('--no-push', dest='push', action='store_false',
                     help='Do not push to try as a result of running this command (if '
                          'specified this command will only print calculated try '
                          'syntax and selection info).')
    def autotry(self, builds=None, platforms=None, paths=None, verbose=None,
                extra_tests=None, push=None, tags=None, tests=None):
        """mach try is under development, please file bugs blocking 1149670.

        Pushes the specified tests to try. The simplest way to specify tests is
        by using the -u argument, which will behave as usual for try syntax.
        This command also provides a mechanism to select test jobs and tests
        within a job by path based on tests present in the tree under that
        path. Mochitests, xpcshell tests, and reftests are eligible for
        selection by this mechanism. Selected tests will be run in a single
        chunk of the relevant suite, at this time in chunk 1.

        Specifying platforms is still required with the -p argument (a default
        is taken from the AUTOTRY_PLATFORM_HINT environment variable if set).

        Tests may be further filtered by passing one or more --tag to the
        command. If one or more --tag is specified with out paths or -u,
        tests with the given tags will be run in a single chunk of
        applicable suites.

        To run suites in addition to those determined from the tree, they
        can be passed to the --extra arguent.

        The command requires either its own mercurial extension ("push-to-try",
        installable from mach mercurial-setup) or a git repo using git-cinnabar
        (available at https://github.com/glandium/git-cinnabar).
        """

        from mozbuild.testing import TestResolver
        from mozbuild.controller.building import BuildDriver
        from autotry import AutoTry
        import pprint

        print("mach try is under development, please file bugs blocking 1149670.")

        builds, platforms = self.validate_args(paths, tests, tags, builds, platforms)
        resolver = self._spawn(TestResolver)

        at = AutoTry(self.topsrcdir, resolver, self._mach_context)
        if at.find_uncommited_changes():
            print('ERROR please commit changes before continuing')
            sys.exit(1)

        driver = self._spawn(BuildDriver)
        driver.install_tests(remove=False)

        manifests_by_flavor = at.resolve_manifests(paths=paths, tags=tags)

        if not manifests_by_flavor and not tests:
            print("No tests were found when attempting to resolve paths:\n\n\t%s" %
                  paths)
            sys.exit(1)

        all_manifests = set()
        for m in manifests_by_flavor.values():
            all_manifests |= m
        all_manifests = list(all_manifests)

        msg = at.calc_try_syntax(platforms, manifests_by_flavor.keys(), tests,
                                 extra_tests, builds, all_manifests, tags)

        if verbose and manifests_by_flavor:
            print('Tests from the following manifests will be selected: ')
            pprint.pprint(manifests_by_flavor)

        if verbose:
            print('The following try syntax was calculated:\n\n\t%s\n' % msg)

        if push:
            at.push_to_try(msg, verbose)

        return


def get_parser(argv=None):
    parser = ArgumentParser()
    parser.add_argument(dest="suite_name",
                        nargs=1,
                        choices=['mochitest'],
                        type=str,
                        help="The test for which chunk should be found. It corresponds "
                             "to the mach test invoked (only 'mochitest' currently).")

    parser.add_argument(dest="test_path",
                        nargs=1,
                        type=str,
                        help="The test (any mochitest) for which chunk should be found.")

    parser.add_argument('--total-chunks',
                        type=int,
                        dest='total_chunks',
                        required=True,
                        help='Total number of chunks to split tests into.',
                        default=None
                        )

    parser.add_argument('-f', "--flavor",
                        dest="flavor",
                        type=str,
                        help="Flavor to which the test belongs to.")

    parser.add_argument('--chunk-by-runtime',
                        action='store_true',
                        dest='chunk_by_runtime',
                        help='Group tests such that each chunk has roughly the same runtime.',
                        default=False,
                        )

    parser.add_argument('--chunk-by-dir',
                        type=int,
                        dest='chunk_by_dir',
                        help='Group tests together in the same chunk that are in the same top '
                             'chunkByDir directories.',
                        default=None,
                        )

    return parser


@CommandProvider
class ChunkFinder(MachCommandBase):
    @Command('find-test-chunk', category='testing',
             description='Find which chunk a test belongs to (works for mochitest).',
             parser=get_parser)
    def chunk_finder(self, **kwargs):
        flavor = kwargs['flavor']
        total_chunks = kwargs['total_chunks']
        test_path = kwargs['test_path'][0]
        suite_name = kwargs['suite_name'][0]
        _, dump_tests = tempfile.mkstemp()
        args = {
            'totalChunks': total_chunks,
            'dump_tests': dump_tests,
            'chunkByDir': kwargs['chunk_by_dir'],
            'chunkByRuntime': kwargs['chunk_by_runtime'],
        }

        found = False
        for this_chunk in range(1, total_chunks+1):
            args['thisChunk'] = this_chunk
            try:
                self._mach_context.commands.dispatch(suite_name, self._mach_context, flavor=flavor, resolve_tests=False, **args)
            except SystemExit:
                pass
            except KeyboardInterrupt:
                break

            fp = open(os.path.expanduser(args['dump_tests']), 'r')
            tests = json.loads(fp.read())['active_tests']
            paths = [t['path'] for t in tests]
            if test_path in paths:
                print("The test %s is present in chunk number: %d (it may be skipped)." % (test_path, this_chunk))
                found = True
                break

        if not found:
            raise Exception("Test %s not found." % test_path)
        # Clean up the file
        os.remove(dump_tests)
