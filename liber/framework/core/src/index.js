const Events = require('events');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const config = require('config');
const cors = require('cors');
const compression = require('compression');
const Cache = require('../../cache-memory');
const Logger = require('../../logger');
const pkg = require('../package.json');
const DataProvider = require('./data-provider');
const geoservices = require('../../output-geoservices');

class Koop extends Events {
  #authModule;

  constructor(options) {
    super();
    this.version = pkg.version;

    this.config = { ...options, ...config };
    this.server = initServer(this.config);
    this.log = this.config.logger || new Logger(this.config);

    // default to in-memory cache; another cache registration overrides this
    this.#registerCache(Cache, { size: this.config.cacheSize });
    this.providers = [];
    this.pluginRoutes = [];
    this.outputs = [];

    const { geoservicesDefaults } = this.config;

    if (this.config.skipGeoservicesRegistration !== true) {
      this.register(geoservices, {
        logger: this.log,
        authInfo: this.config.authInfo,
        defaults: geoservicesDefaults
      });  
    }

    this.server
      .on('mount', () => {
        this.log.info(
          `Koop ${this.version} mounted at ${this.server.mountpath}`,
        );
      })
      .get('/status', (req, res) => res.json({
        success: true
      }));
  }

  register(plugin, options) {
    if (!plugin) {
      throw new Error('Plugin registration failed: plugin undefined');
    }

    if (plugin.type === 'provider') {
      return this.#registerProvider(plugin, options);
    }

    if (plugin.type === 'cache') {
      return this.#registerCache(plugin, options);
    }

    if (plugin.type === 'output') {
      return this.#registerOutput(plugin, options);
    }

    if (plugin.type === 'auth') {
      return this.#registerAuth(plugin, options);
    }

    this.log.warn(
      'Unrecognized plugin type: "' +
        plugin.type +
        '". Defaulting to provider.',
    );
    return this.#registerProvider(plugin, options);
  }

  #registerProvider(pluginDefinition, options) {
    const dataProvider = new DataProvider({
      logger: this.log,
      cache: this.cache,
      authModule: this.#authModule,
      pluginDefinition,
      outputPlugins: this.outputs,
      options,
    });
    dataProvider.addRoutesToServer(this.server);
    this.providers.push(dataProvider);
    this.log.info(
      `registered provider: ${dataProvider.namespace} v${dataProvider.version}`,
    );
  }

  #registerOutput(outputClass, options) {
    this.outputs.push({ outputClass, options });
    this.log.info(
      `registered output: ${outputClass.name} v${outputClass.version}`,
    );
  }

  #registerCache(Cache, options) {
    this.cache = new Cache({ logger: options?.logger || this.log, options });
    this.log.info(`registered cache: ${Cache.name} v${Cache.version}`);
  }
  
  #registerAuth (auth) {
    this.#authModule = auth;
    this.log.info(`registered auth module: ${auth.name} v${auth.version}`);
  }
}

/**
 * express middleware setup
 */
function initServer(options) {
  const app = express()
    // parse application/json
    .use(bodyParser.json({ limit: options.bodyParserLimit || '10000kb' }))
    // parse application/x-www-form-urlencoded
    .use(bodyParser.urlencoded({ extended: false }))
    .disable('x-powered-by')
    // for demos and preview maps in providers
    .set('view engine', 'ejs')
    .use(express.static(path.join(__dirname, '/public')));

  // Use CORS unless explicitly disabled in the config
  if (options.disableCors !== true) {
    app.use(cors());
  }

  // Use compression unless explicitly disable in the config
  if (options.disableCompression !== true) {
    app.use(compression());
  }

  return app;
}

module.exports = Koop;
