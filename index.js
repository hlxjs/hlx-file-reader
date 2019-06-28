const ReadStream = require('./readable');

function createReadStream(location, options = {}) {
  return new ReadStream(location, options);
}

module.exports = {createReadStream};
// es2015 default export compatibility
module.exports.default = module.exports;
