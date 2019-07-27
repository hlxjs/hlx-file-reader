const path = require('path');
const {URL} = require('url');

function THROW(err) {
  throw err;
}

function ASSERT(msg, ...params) {
  for (const [index, param] of params.entries()) {
    if (!param) {
      THROW(new Error(`${msg} : Failed at [${index}]`));
    }
  }
}

function PARAMCHECK(...params) {
  for (const [index, param] of params.entries()) {
    if (param === undefined) {
      THROW(new Error(`Param Check : Failed at [${index}]`));
    }
  }
}

function CONDITIONALPARAMCHECK(...params) {
  for (const [index, [cond, param]] of params.entries()) {
    if (!cond) {
      continue;
    }
    if (param === undefined) {
      THROW(new Error(`Conditional Param Check : Failed at [${index}]`));
    }
  }
}

function _empty() {}

function tryCatch(...params) {
  const body = params.shift();
  try {
    return body();
  } catch (err) {
    if (params.length > 0) {
      return tryCatch(...params);
    }
    throw err;
  }
}

function createUrl(url, base = '') {
  return tryCatch(
    () => {
      return new URL(url);
    },
    () => {
      return new URL(url, base);
    },
    () => {
      return pathToFileURL(base, url);
    }
  );
}

function resolveUrl({rootPath = ''}, ...params) {
  return params.reduce((accum, curr) => {
    if (curr instanceof URL) {
      return curr;
    }
    const type = getUrlType(curr);
    if (type === 'absolute') {
      return new URL(curr);
    }
    if (type === 'scheme-relative') {
      if (accum) {
        return new URL(`${accum.protocol}${curr}`);
      }
      return new URL(`http:${curr}`);
    }
    if (type === 'path-absolute') {
      if (accum && accum.protocol !== 'file:') {
        return new URL(curr, accum.href);
      }
    }
    if (type === 'path-relative') {
      if (accum) {
        return new URL(curr, accum.href);
      }
    }
    return pathToFileURL(path.join(rootPath, curr));
  }, null);
}

function getUrlType(url) {
  if (tryCatch(
      () => {
        url = new URL(url);
        return true;
      },
      () => {
        return false;
      }
    )) {
    return 'absolute';
  }

  if (url.startsWith('//')) {
    return 'scheme-relative';
  }

  if (url.startsWith('/')) {
    return 'path-absolute';
  }

  return 'path-relative';
}

function fileURLToPath(url) {
  return url.pathname;
}

function pathToFileURL(...params) {
  const fullPath = path.resolve(...params);
  return new URL(`file://${fullPath}`);
}

module.exports = {
  THROW,
  ASSERT: process.env.NODE_ENV === 'production' ? _empty : ASSERT,
  PARAMCHECK: process.env.NODE_ENV === 'production' ? _empty : PARAMCHECK,
  CONDITIONALPARAMCHECK: process.env.NODE_ENV === 'production' ? _empty : CONDITIONALPARAMCHECK,
  tryCatch,
  createUrl,
  resolveUrl,
  fileURLToPath,
  pathToFileURL,
  masterPlaylistTimeout: 10
};
