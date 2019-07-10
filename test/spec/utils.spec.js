const {URL} = require('url');
const path = require('path');
const test = require('ava');
const proxyquire = require('proxyquire');

const mockFs = {
  existsSync(path) {
    return path === '/path/to/file';
  }
};

const utils = proxyquire('../../utils', {fs: mockFs});

test('utils.THROW', t => {
  try {
    utils.THROW(new Error('abc'));
  } catch (err) {
    t.truthy(err);
    t.is(err.message, 'abc');
  }
});

test('utils.ASSERT', t => {
  utils.ASSERT('No error occurs', 1, 2, 3);
  try {
    utils.ASSERT('Error occurs', 1, 2, false);
  } catch (err) {
    t.truthy(err);
    t.is(err.message, 'Error occurs : Failed at [2]');
  }
});

test('utils.PARAMCHECK', t => {
  utils.PARAMCHECK(1, 2, 3);
  try {
    utils.PARAMCHECK(1, 2, undefined);
  } catch (err) {
    t.truthy(err);
    t.is(err.message, 'Param Check : Failed at [2]');
  }
});

test('utils.CONDITIONALPARAMCHECK', t => {
  utils.CONDITIONALPARAMCHECK([true, 1], [true, 2], [true, 3]);
  utils.CONDITIONALPARAMCHECK([false, undefined], [false, 1], [false, 2]);
  try {
    utils.CONDITIONALPARAMCHECK([false, undefined], [true, 1], [true, undefined]);
  } catch (err) {
    t.truthy(err);
    t.is(err.message, 'Conditional Param Check : Failed at [2]');
  }
});

test('utils.tryCatch', t => {
  let result = utils.tryCatch(
    () => {
      return 1;
    },
    () => {
      return 0;
    }
  );
  t.is(result, 1);
  result = utils.tryCatch(
    () => {
      return JSON.parse('{{');
    },
    () => {
      return 0;
    }
  );
  t.is(result, 0);
  t.throws(() => {
    utils.tryCatch(
      () => {
        return JSON.parse('{{');
      },
      () => {
        return JSON.parse('}}');
      }
    );
  });
  result = utils.tryCatch(
    () => {
      return JSON.parse('{{');
    },
    () => {
      return JSON.parse('}}');
    },
    () => {
      return 0;
    }
  );
  t.is(result, 0);
});

test('utils.resolveUrl', t => {
  let url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext');
  t.is(url.href, 'https://abc.com/dir/file.ext');
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext', '//def.com/dir/file.ext');
  t.is(url.href, 'https://def.com/dir/file.ext');
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext', '/dir2/file.ext');
  t.is(url.href, 'https://abc.com/dir2/file.ext');
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext', 'dir2/file.ext');
  t.is(url.href, 'https://abc.com/dir/dir2/file.ext');
  url = utils.resolveUrl({}, '/path/to/file');
  t.is(url.href, 'file:///path/to/file');
  url = utils.resolveUrl({}, '/path/to/non-file');
  t.is(url.href, 'file:///path/to/non-file');
  url = utils.resolveUrl({rootPath: '/var'}, '/path/to/non-file');
  t.is(url.href, 'file:///var/path/to/non-file');
  url = utils.resolveUrl({rootPath: '/var'}, '../path/to/non-file');
  t.is(url.href, 'file:///path/to/non-file');
  url = utils.resolveUrl({}, './path/to/non-file');
  t.is(url.href, `file://${process.cwd()}/path/to/non-file`);
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext', '/dir2/file.ext', 'low/01.ts');
  t.is(url.href, 'https://abc.com/dir2/low/01.ts');
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext', 'dir2/file.ext', '01.ts');
  t.is(url.href, 'https://abc.com/dir/dir2/01.ts');
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext?version=1', '/dir2/file.ext?version=2');
  t.is(url.href, 'https://abc.com/dir2/file.ext?version=2');
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext?version=1', 'dir2/file.ext?version=2');
  t.is(url.href, 'https://abc.com/dir/dir2/file.ext?version=2');
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext#default', '/dir2/file.ext#default2');
  t.is(url.href, 'https://abc.com/dir2/file.ext#default2');
  url = utils.resolveUrl({}, 'https://abc.com/dir/file.ext#default', 'dir2/file.ext#default2');
  t.is(url.href, 'https://abc.com/dir/dir2/file.ext#default2');
});

test('utils.createUrl', t => {
  let url = utils.createUrl('http://abc.com');
  t.is(url.href, 'http://abc.com/');
  url = utils.createUrl('http://abc.com', 'http://def.com');
  t.is(url.href, 'http://abc.com/');
  url = utils.createUrl('/abc', 'http://def.com');
  t.is(url.href, 'http://def.com/abc');
});

test('utils.fileURLToPath', t => {
  const PATH = '/path/to/here';
  const result = utils.fileURLToPath(new URL(`file://${PATH}`));
  t.is(result, PATH);
});

test('utils.pathToFileURL', t => {
  const PATH = '/path/to/here';
  const result = utils.pathToFileURL(PATH);
  t.is(result.pathname, PATH);
});

test('utils.pathToFileURL(...params)', t => {
  const PATH = '../there';
  const BASEPATH = '/path/to/here';
  const result = utils.pathToFileURL(BASEPATH, PATH);
  t.is(result.pathname, path.resolve(BASEPATH, PATH));
});
