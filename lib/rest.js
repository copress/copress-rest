"use strict";

var _ = require('lodash');
var cancelify = require('cancelify');
var async = require('async');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var sycle = require('sycle');
var express = require('express');
var debug = require('debug')('sycle:rest');

var bodyParser = require('body-parser');
var cors = require('cors');

var json = bodyParser.json;
var urlencoded = bodyParser.urlencoded;

var SUPPORTED_TYPES = ['json', 'application/javascript', 'text/javascript'];

exports = module.exports = function (remotes, sapp) {
    if (remotes.remotes && remotes.handle) {
        sapp = remotes;
        remotes = sapp.remotes;
    }
    var rest = new Rest(remotes, sapp);
    return rest.createHandler();
};

exports.Rest = Rest;
exports.RestClass = RestClass;
exports.RestMethod = RestMethod;
exports.sortRoutes = sortRoutes;

function Rest(remotes, sapp) {
    EventEmitter.call(this);

    this.remotes = remotes;
    this.sapp = sapp;
}

util.inherits(Rest, EventEmitter);

Rest.prototype.createHandler = function () {
    var root = express.Router();
    var rest = this;
    var classes = root.classes = this.buildClasses();

    // Add a handler to tolerate empty json as connect's json middleware throws an error
    root.use(function (req, res, next) {
        if (req.is('application/json')) {
            if (req.get('Content-Length') === '0') { // This doesn't cover the transfer-encoding: chunked
                req._body = true; // Mark it as parsed
                req.body = {};
            }
        }
        next();
    });

    // Set strict to be `false` so that anything `JSON.parse()` accepts will be parsed
    debug("remoting options: %j", this.remotes.options);
    var urlencodedOptions = this.remotes.options.urlencoded || {extended: true};
    if (urlencodedOptions.extended === undefined) {
        urlencodedOptions.extended = true;
    }
    var jsonOptions = this.remotes.options.json || {strict: false};
    var corsOptions = this.remotes.options.cors || {};
    root.use(urlencoded(urlencodedOptions));
    root.use(json(jsonOptions));
    root.use(cors(corsOptions));

    classes.forEach(function (restClass) {
        var router = express.Router();
        var className = restClass.sharedClass.name;

        debug('registering REST handler for class %j', className);

        var methods = [];
        // Register handlers for all shared methods of this class sharedClass
        restClass
            .methods
            .forEach(function (restMethod) {
                var sharedMethod = restMethod.sharedMethod;
                debug('    method %s', sharedMethod.stringName);
                restMethod.routes.forEach(function (route) {
                    methods.push({route: route, method: sharedMethod});
                });
            });

        // Sort all methods based on the route path
        methods.sort(sortRoutes);

        methods.forEach(function (m) {
            rest._registerMethodRouteHandlers(router, m.method, m.route);
        });

        // Convert requests for unknown methods of this sharedClass into 404.
        // Do not allow other middleware to invade our URL space.
        router.use(Rest.remoteMethodNotFoundHandler(className));

        // Mount the remoteClass router on all class routes.
        restClass
            .routes
            .forEach(function (route) {
                debug('    at %s', route.path);
                root.use(route.path, router);
            });

    });

    // Convert requests for unknown URLs into 404.
    // Do not allow other middleware to invade our URL space.
    root.use(Rest.urlNotFoundHandler());

    // Use our own error handler to make sure the error response has
    // always the format expected by remoting clients.
    root.use(Rest.errorHandler());

    return root;
};

Rest.prototype.buildClasses = function () {
    return Rest.buildClasses(this.remotes);
};

Rest.prototype._registerMethodRouteHandlers = function (router, sharedMethod, route) {
    debug('        %s %s %s', route.verb, route.path, sharedMethod.stringName);
    var verb = route.verb;
    if (verb === 'del') {
        // Express 4.x only supports delete
        verb = 'delete';
    }
    var rest = this;
    router[verb](route.path, function (req, res, next) {
        var context = new RestContext(req, res, sharedMethod, rest.sapp);
        rest._handleRequest(context, sharedMethod, next);
    });
};

Rest.prototype._handleRequest = function (ctx, method, next) {

    var remotes = this.remotes;
    var steps = [];

    if (method.rest.before) {
        steps.push(function invokeRestBefore(cb) {
            debug('Invoking rest.before for ' + ctx.methodString);
            method.rest.before.call(remotes.getScope(ctx, method), ctx, cb);
        });
    }

    steps.push(function (cb) {
        ctx.handle(method, cb);
    });

    if (method.rest.after) {
        steps.push(function invokeRestAfter(cb) {
            debug('Invoking rest.after for ' + ctx.methodString);
            method.rest.after.call(remotes.getScope(ctx, method), ctx, cb);
        });
    }

    async.series(steps, function (err) {
        if (err) return next(err);
        ctx.done();
    });
};

Rest.buildClasses = function (source) {
    var classes = Array.isArray(source) ? source : (source.remotes || source).classes();
    return classes.map(RestClass);
};

Rest.remoteMethodNotFoundHandler = function (className) {
    className = className || '(unknown)';
    return function restRemoteMethodNotFound(req, res, next) {
        var message = 'Shared class "' + className + '"' +
            ' has no method handling ' + req.method + ' ' + req.url;
        var error = new Error(message);
        error.status = error.statusCode = 404;
        next(error);
    };
};

Rest.urlNotFoundHandler = function () {
    return function restUrlNotFound(req, res, next) {
        var message = 'There is no method to handle ' + req.method + ' ' + req.url;
        var error = new Error(message);
        error.status = error.statusCode = 404;
        next(error);
    };
};

Rest.errorHandler = function () {
    return function restErrorHandler(err, req, res, next) {
        if (typeof err === 'string') {
            err = new Error(err);
            err.status = err.statusCode = 500;
        }

        res.statusCode = err.statusCode || err.status || 500;

        debug('Error in %s %s: %s', req.method, req.url, err.stack);
        var data = {
            name: err.name,
            status: res.statusCode,
            message: err.message || 'An unknown error occurred'
        };

        for (var prop in err)
            data[prop] = err[prop];

        // TODO(bajtos) Remove stack info when running in production
//        data.stack = err.stack;

        res.send({ error: data });
    };
};

Rest.prototype.allRoutes = function () {
    var routes = [];
    var adapter = this;
    var classes = this.remotes.classes();
    var currentRoot = '';

    classes.forEach(function (sc) {
        adapter
            .getRoutes(sc)
            .forEach(function (classRoute) {
                currentRoot = classRoute.path;
                var methods = sc.methods();

                methods.forEach(function (method) {
                    adapter.getRoutes(method).forEach(function (route) {
                        if (method.isStatic) {
                            addRoute(route.verb, route.path, method);
                        } else {
                            adapter
                                .getRoutes(method.sharedCtor)
                                .forEach(function (sharedCtorRoute) {
                                    addRoute(route.verb, sharedCtorRoute.path + route.path, method);
                                });
                        }
                    });
                });
            });
    });

    return routes;


    function addRoute(verb, path, method) {
        if (path === '/' || path === '//') {
            path = currentRoot;
        } else {
            path = currentRoot + path;
        }

        if (path[path.length - 1] === '/') {
            path = path.substr(0, path.length - 1);
        }

        // TODO this could be cleaner
        path = path.replace(/\/\//g, '/');

        routes.push({
            verb: verb,
            path: path,
            description: method.description,
            method: method.stringName,
            accepts: (method.accepts && method.accepts.length) ? method.accepts : undefined,
            returns: (method.returns && method.returns.length) ? method.returns : undefined
        });
    }
};

/*!
 * Compare two routes
 * @param {Object} r1 The first route {route: {verb: 'get', path: '/:id'}, method: ...}
 * @param [Object} r2 The second route route: {verb: 'get', path: '/findOne'}, method: ...}
 * @returns {number} 1: r1 comes after 2, -1: r1 comes before r2, 0: equal
 */
function sortRoutes(r1, r2) {
    var a = r1.route;
    var b = r2.route;

    // Normalize the verbs
    var verb1 = a.verb.toLowerCase();
    var verb2 = b.verb.toLowerCase();

    if (verb1 === 'del') {
        verb1 = 'delete';
    }
    if (verb2 === 'del') {
        verb2 = 'delete';
    }
    // First sort by verb
    if (verb1 > verb2) {
        return -1;
    } else if (verb1 < verb2) {
        return 1;
    }

    // Sort by path part by part using the / delimiter
    // For example '/:id' will become ['', ':id'], '/findOne' will become
    // ['', 'findOne']
    var p1 = a.path.split('/');
    var p2 = b.path.split('/');
    var len = Math.min(p1.length, p2.length);

    // Loop through the parts and decide which path should come first
    for (var i = 0; i < len; i++) {
        // Empty part has lower weight
        if (p1[i] === '' && p2[i] !== '') {
            return 1;
        } else if (p1[i] !== '' && p2[i] === '') {
            return -1;
        }
        // Wildcard has lower weight
        if (p1[i][0] === ':' && p2[i][0] !== ':') {
            return 1;
        } else if (p1[i][0] !== ':' && p2[i][0] === ':') {
            return -1;
        }
        // Now the regular string comparision
        if (p1[i] > p2[i]) {
            return 1;
        } else if (p1[i] < p2[i]) {
            return -1;
        }
    }
    // Both paths have the common parts. The longer one should come before the
    // shorter one
    return p2.length - p1.length;
}

/**
 * Get the path for the given method.
 */

//Rest.prototype.buildRoutes = buildRoutes;
function buildRoutes(obj) {
    var routes = obj.http;

    if (routes && !Array.isArray(routes)) {
        routes = [routes];
    }

    // overidden
    if (routes) {
        // patch missing verbs / routes
        routes.forEach(function (r) {
            r.verb = String(r.verb || 'all').toLowerCase();
            r.path = r.path || ('/' + obj.name);
        });
    } else {
        if (obj.name === 'sharedCtor') {
            routes = [
                {
                    verb: 'all',
                    path: '/prototype'
                }
            ];
        } else {
            // build default route
            routes = [
                {
                    verb: 'all',
                    path: obj.name ? ('/' + obj.name) : ''
                }
            ];
        }
    }

    return routes;
}

function RestClass(sharedClass) {
    if (!(this instanceof RestClass)) return new RestClass(sharedClass);

    hiddenConstProperty(this, 'sharedClass', sharedClass);

    var self = this;
    this.name = sharedClass.name;
    this.routes = buildRoutes(sharedClass);

    this.ctor = sharedClass.sharedCtor && new RestMethod(this, sharedClass.sharedCtor);

    this.methods = sharedClass.methods()
        .filter(function (sm) {
            return !sm.isSharedCtor;
        })
        .map(function (sm) {
            return new RestMethod(self, sm);
        });
}

RestClass.prototype.getPath = function () {
    return this.routes[0].path;
};

function RestMethod(restClass, sharedMethod) {
    hiddenConstProperty(this, 'restClass', restClass);
    hiddenConstProperty(this, 'sharedMethod', sharedMethod);

    // The full name is ClassName.methodName or ClassName.prototype.methodName
    this.fullName = sharedMethod.stringName;
    this.name = this.fullName.split('.').slice(1).join('.');

    this.accepts = sharedMethod.accepts;
    this.returns = sharedMethod.returns;
    this.description = sharedMethod.description;

    var methodRoutes = buildRoutes(sharedMethod);
    if (sharedMethod.isStatic || !restClass.ctor) {
        this.routes = methodRoutes;
    } else {
        var routes = this.routes = [];
        methodRoutes.forEach(function (route) {
            restClass.ctor.routes.forEach(function (ctorRoute) {
                var fullRoute = util._extend({}, route);
                fullRoute.path = joinPaths(ctorRoute.path, route.path);
                routes.push(fullRoute);
            });
        });
    }
}

RestMethod.prototype.isReturningArray = function () {
    return this.returns.length == 1 &&
        this.returns[0].root &&
        getTypeString(this.returns[0].type) === 'array' || false;
};

RestMethod.prototype.acceptsSingleBodyArgument = function () {
    if (this.accepts.length != 1) return false;
    var accepts = this.accepts[0];

    return accepts.http &&
        accepts.http.source == 'body' &&
        getTypeString(accepts.type) == 'object' || false;
};

RestMethod.prototype.getHttpMethod = function () {
    var verb = this.routes[0].verb;
    if (verb == 'all') return 'POST';
    if (verb == 'del') return 'DELETE';
    return verb.toUpperCase();
};

RestMethod.prototype.getPath = function () {
    return this.routes[0].path;
};

RestMethod.prototype.getFullPath = function () {
    return joinPaths(this.restClass.getPath(), this.getPath());
};

function RestContext(req, res, method, sapp) {
    this.req = req;
    this.res = res;
    this.method = method;
    this.sapp = sapp;
}

RestContext.prototype.handle = function (method, cb) {
    var self = this, req = this.req, finished;

    // future may be null if some sycle middleware are async
    var future = this.sapp.ask(method)
        .props(_.omit(req, ['param', 'host']))
        .payload(req.body)
        .send(function (err, result) {
            finished = true;
            if (err) return cb(err);
            self.result = result;
            cb();
        });

    future.canceled(function (err) {
        if (finished) return;
        debug('request has been canceled - ' + req.url);
    });

    this.req.on('close', function () {
        if (!finished) future.cancel();
    });
};

RestContext.prototype.done = function () {
    // send the result back as
    // the requested content type
    var data = this.result;
    var res = this.res;
    var accepts = this.req.accepts(SUPPORTED_TYPES);
    var dataExists = typeof data !== 'undefined';

    if (dataExists) {
        switch (accepts) {
            case 'json':
                res.json(data);
                break;
            case 'application/javascript':
            case 'text/javascript':
                res.jsonp(data);
                break;
            default:
                // not acceptable
                res.send(406);
                break;
        }
    } else {
        res.header('Content-Type', 'application/json');
        res.statusCode = 204;
        res.end();
    }
};


function hiddenConstProperty(where, property, value) {
    Object.defineProperty(where, property, {
        writable: false,
        enumerable: false,
        configurable: false,
        value: value
    });
}

function getTypeString(ctorOrName) {
    if (Array.isArray(ctorOrName)) {
        ctorOrName = 'array';
    }
    if (typeof ctorOrName === 'function') {
        ctorOrName = ctorOrName.name;
    }
    if (typeof ctorOrName === 'string') {
        return ctorOrName.toLowerCase();
    } else {
        debug('WARNING: unknown ctorOrName of type %s: %j', typeof ctorOrName, ctorOrName);
        return typeof undefined;
    }
}

function joinPaths(left, right) {
    if (!left) return right;
    if (!right || right == '/') return left;

    var glue = left[left.length - 1] + right[0];
    if (glue == '//')
        return left + right.slice(1);
    else if (glue[0] == '/' || glue[1] == '/')
        return left + right;
    else
        return left + '/' + right;
}




