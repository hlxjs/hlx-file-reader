const fs = require('fs');
const fetch = require('node-fetch');
const debug = require('debug');

const print = debug('hlx-file-reader');

function fileFetch(path, {readAsBuffer, rawResponse}) {
  print(`fileFetch(${path}, readAsBuffer=${readAsBuffer}, rawResponse=${rawResponse})`);
  if (!fs.existsSync(path)) {
    return Promise.reject(new Error(`File not found: ${path}`));
  }
  const encoding = readAsBuffer ? null : 'utf8';
  if (rawResponse) {
    const data = fs.createReadStream(path, {encoding});
    return Promise.resolve({data});
  }
  return new Promise((resolve, reject) => {
    fs.readFile(path, {encoding}, (err, data) => {
      if (err) {
        return reject(err);
      }
      return resolve({data});
    });
  });
}

function urlFetch(url, {readAsBuffer, rawResponse}) {
  print(`urlFetch(${url}, readAsBuffer=${readAsBuffer}, rawResponse=${rawResponse})`);
  return fetch(url)
  .then(res => {
    if (res.status < 200 || res.status >= 300) {
      return Promise.reject(new Error(`${res.status} ${res.statusText}`));
    }
    const mimeType = res.headers ? res.headers.get('Content-Type') : null;

    if (rawResponse) {
      return {data: res.body, mimeType};
    }

    if (readAsBuffer) {
      return res.buffer().then(data => {
        return {data, mimeType};
      });
    }
    return res.text().then(data => {
      return {data, mimeType};
    });
  });
}

function universalFetch(url, options = {}) {
  if (url.protocol) {
    return urlFetch(url.href, options);
  }
  return fileFetch(url.href, options);
}

module.exports = universalFetch;
