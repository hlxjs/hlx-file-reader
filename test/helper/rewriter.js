const {URL} = require('url');

function tryCatch(...params) {
  const func = params.shift();
  try {
    return func();
  } catch (err) {
    if (params.length > 0) {
      return tryCatch(...params);
    }
    throw err;
  }
}

function getUrlObj(url) {
  return tryCatch(
    () => {
      return new URL(url);
    },
    () => {
      return null;
    }
  );
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

let baseHostName = '';

function defaultFunc(data) {
  if (data.type === 'playlist') {
    if (data.isMasterPlaylist) {
      rewrite(data, true);
      const {variants, sessionDataList, sessionKeyList} = data;
      for (const variant of variants) {
        rewrite(variant);
        const {audio, video, subtitles, closedCaptions} = variant;
        [audio, video, subtitles, closedCaptions].forEach(rewriteUrls);
      }
      [sessionDataList, sessionKeyList].forEach(rewriteUrls);
    } else {
      rewrite(data, true);
      rewriteUrls(data.segments);
    }
  }
}

function rewriteUrls(list) {
  for (const item of list) {
    rewrite(item);
    if (item.type === 'segment') {
      rewrite(item.key);
      rewrite(item.map);
    }
  }
}

function rewrite(data, saveAsBaseUrl) {
  if (!data || data.__hlx_url_rewriter_visited__) {
    return;
  }

  let {uri} = data;

  if (saveAsBaseUrl) {
    baseHostName = '';
  }

  let type = getUrlType(uri);

  if (type === 'scheme-relative') {
    uri = `http:${uri}`;
    type = 'absolute';
  }

  if (type === 'absolute') {
    const obj = getUrlObj(uri);
    if (saveAsBaseUrl) {
      baseHostName = obj.hostname;
    }
    data.uri = `/${obj.hostname}/xxx${obj.search}${obj.hash}`;
  } else if (type === 'path-absolute' && baseHostName) {
    data.uri = `/${baseHostName}/xxx`;
  }
  data.__hlx_url_rewriter_visited__ = true;
}

module.exports = defaultFunc;
