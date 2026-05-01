const handlers = {
  deck: require('./formats/deck'),
  email: require('./formats/email'),
};

async function route(format, payload) {
  const handler = handlers[format];
  if (!handler) {
    const supported = Object.keys(handlers).join(', ');
    const err = new Error(`Unsupported format: "${format}". Supported: ${supported}`);
    err.statusCode = 400;
    throw err;
  }
  const { atoms, audience, solutionName, context } = payload;
  return handler(atoms, audience, solutionName, context);
}

module.exports = { route };
