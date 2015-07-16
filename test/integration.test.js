"use strict";

var express = require('express');
var request = require('supertest');
var sycle = require('sycle');
var inherits = require('util').inherits;
var cancelify = require('cancelify');

var rest = require('../lib/rest');

var s = require('./support');
var t = s.t;
var assert = s.t;

describe('integration', function () {

    var app, server, sapp, handler;

    function json(method, url) {
        if (url === undefined) {
            url = method;
            method = 'get';
        }

        return request(app)[method](url)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .expect('Content-Type', /json/);
    }

    function setup(fns) {
        return createSapp(fns, function (err, _sapp) {
            if (err) throw err;
            sapp = _sapp;
            handler = rest(_sapp);
        });
    }

    function setupAndGivenSharedStaticMethod(fn, config) {
        var result = null;
        setup(function (sapp) {
            result = givenSharedStaticMethod(sapp, fn, config);
        });
        return result;
    }

    before(function (done) {
        app = express();
        app.disable('x-powered-by');
        app.use(function () {
            handler.apply(undefined, arguments);
        });
        server = app.listen(done);
    });

    describe('remoting options', function () {
        it('should reject json payload larger than 1kb', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function greet(msg, cb) {
                    cb(null, msg);
                },
                {
                    accepts: { arg: 'person', type: 'string', source: 'payload'},
                    returns: { arg: 'msg', type: 'string' }
                }
            );

            // Build an object that is larger than 1kb
            var name = "";
            for (var i = 0; i < 2048; i++) {
                name += "11111111111";
            }

            request(app)['post'](method.url)
                .set('Accept', 'application/json')
                .set('Content-Type', 'application/json')
                .send(name)
                .expect(413, done);
        });
    });

    describe('call of constructor method', function () {
        it('should work', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function greet(msg, cb) {
                    cb(null, msg);
                },
                {
                    accepts: { arg: 'person', type: 'string' },
                    returns: { arg: 'msg', type: 'string' }
                }
            );

            json(method.url + '?person=hello')
                .expect(200, { msg: 'hello' }, done);
        });

        it('should allow custom argument functions', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, b, cb) {
                    cb(null, a + b);
                },
                {
                    accepts: [
                        { arg: 'b', type: 'number' },
                        { arg: 'a', type: 'number', source: function (ctx) {
                            return ctx.request.param('a');
                        } }
                    ],
                    returns: { arg: 'n', type: 'number' },
                    http: { path: '/' }
                }
            );

            json(method.classUrl + '/?a=1&b=2')
                .expect({ n: 3 }, done);
        });


        it('should pass undefined if the argument is not supplied', function (done) {
            var called = false;
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, cb) {
                    called = true;
                    t(a === undefined, 'a should be undefined');
                    cb();
                },
                {
                    accepts: [
                        { arg: 'b', type: 'number' }
                    ]
                }
            );

            json(method.url).end(function () {
                t(called);
                done();
            });
        });

        it('should allow arguments in the body', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, cb) {
                    cb(null, a);
                },
                {
                    accepts: [
                        { arg: 'a', type: 'object', source: 'payload' }
                    ],
                    returns: { arg: 'data', type: 'object', root: true },
                    http: { path: '/' }
                }
            );

            request(app)['post'](method.classUrl)
                .set('Accept', 'application/json')
                .set('Content-Type', 'application/json')
                .send('{"x": 1, "y": "Y"}')
                .expect('Content-Type', /json/)
                .expect(200, function (err, res) {
                    t.deepEqual(res.body, {"x": 1, "y": "Y"});
                    done(err, res);
                });
        });

        it('should allow arguments in the body with date', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, cb) {
                    cb(null, a);
                },
                {
                    accepts: [
                        { arg: 'a', type: 'object', source: 'payload' }
                    ],
                    returns: { arg: 'data', type: 'object', root: true },
                    http: { path: '/' }
                }
            );

            var data = {date: {$type: 'date', $data: new Date()}};
            request(app)['post'](method.classUrl)
                .set('Accept', 'application/json')
                .set('Content-Type', 'application/json')
                .send(data)
                .expect('Content-Type', /json/)
                .expect(200, function (err, res) {
                    t.deepEqual(res.body, {date: data.date.$data.toISOString()});
                    done(err, res);
                });
        });


        it('should allow arguments in the form', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, b, cb) {
                    cb(null, a + b);
                },
                {
                    accepts: [
                        { arg: 'b', type: 'number' },
                        { arg: 'a', type: 'number' }
                    ],
                    returns: { arg: 'n', type: 'number' },
                    http: { path: '/' }
                }
            );

            request(app)['post'](method.classUrl)
                .set('Accept', 'application/json')
                .set('Content-Type', 'application/x-www-form-urlencoded')
                .send('a=1&b=2')
                .expect('Content-Type', /json/)
                .expect({ n: 3 }, done);
        });


        it('should allow arguments from http req and res', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(req, cb) {
                    cb(null, req.body);
                },
                {
                    accepts: [
                        { arg: 'req', type: 'object', source: 'req' }
                    ],
                    returns: { arg: 'data', type: 'object', root: true },
                    http: { path: '/' }
                }
            );

            request(app)['post'](method.classUrl)
                .set('Accept', 'application/json')
                .set('Content-Type', 'application/json')
                .send('{"x": 1, "y": "Y"}')
                .expect('Content-Type', /json/)
                .expect(200, function (err, res) {
                    t.deepEqual(res.body, {"x": 1, "y": "Y"});
                    done(err, res);
                });
        });


        it('should allow arguments from http context', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(ctx, cb) {
                    cb(null, ctx.req.body);
                },
                {
                    accepts: [
                        { arg: 'ctx', type: 'object', source: 'context' }
                    ],
                    returns: { arg: 'data', type: 'object', root: true },
                    http: { path: '/' }
                }
            );

            request(app)['post'](method.classUrl)
                .set('Accept', 'application/json')
                .set('Content-Type', 'application/json')
                .send('{"x": 1, "y": "Y"}')
                .expect('Content-Type', /json/)
                .expect(200, function (err, res) {
                    t.deepEqual(res.body, {"x": 1, "y": "Y"});
                    done(err, res);
                });
        });


        it('should respond with 204 if returns is not defined', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function (cb) {
                    cb(null, 'value-to-ignore');
                }
            );

            json(method.url)
                .expect(204, done);
        });


        it('should respond with named results if returns has multiple args', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function (a, b, cb) {
                    cb(null, a, b);
                },
                {
                    accepts: [
                        { arg: 'a', type: 'number' },
                        { arg: 'b', type: 'number' }
                    ],
                    returns: [
                        { arg: 'a', type: 'number' },
                        { arg: 'b', type: 'number' }
                    ]
                }
            );

            json(method.url + '?a=1&b=2')
                .expect({a: 1, b: 2}, done);
        });


        it('should remove any X-Powered-By header to LoopBack', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function (cb) {
                    cb(null, 'value-to-ignore');
                }
            );

            json(method.url)
                .expect(204)
                .end(function (err, result) {

                    t.notProperty(result.headers, ['x-powered-by']);
                    done();
                });
        });

        it('should report error for mismatched arg type', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, cb) {
                    cb(null, a);
                },
                {
                    accepts: [
                        { arg: 'a', type: 'object' }
                    ],
                    returns: { root: true }
                }
            );

            json(method.url + '?a=foo')
                .expect(400, done);
        });


        it('should coerce boolean strings - true', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, cb) {
                    cb(null, a);
                },
                {
                    accepts: [
                        { arg: 'a', type: 'object' }
                    ],
                    returns: { root: true }
                }
            );

            json(method.url + '?a[foo]=true')
                .expect({foo: true}, done);
        });

        it('should coerce boolean strings - false', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, cb) {
                    cb(null, a);
                },
                {
                    accepts: [
                        { arg: 'a', type: 'object' }
                    ],
                    returns: { root: true }
                }
            );

            json(method.url + '?a[foo]=false')
                .expect({foo: false}, done);
        });


        it('should coerce number strings', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, b, fn) {
                    fn(null, a + b);
                },
                {
                    accepts: [
                        {arg: 'a', type: 'number'},
                        {arg: 'b', type: 'number'}
                    ],
                    returns: { root: true }
                }
            );

            json(method.url + '?a=42&b=0.42')
                .expect(200, function (err, res) {
                    assert.equal(res.body, 42.42);
                    done();
                });
        });

        it('should allow empty body for json request', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function bar(a, b, fn) {
                    fn(null, a, b);
                },
                {
                    accepts: [
                        {arg: 'a', type: 'number'},
                        {arg: 'b', type: 'number'}
                    ],
                    returns: [
                        {arg: 'a', type: 'number'},
                        {arg: 'b', type: 'number'}
                    ]
                }
            );

            json('post', method.url + '?a=1&b=2').set('Content-Length', 0)
                .expect({a: 1, b: 2}, done);
        });

//    it('should call rest hooks', function(done) {
//        var hooksCalled = [];
//
//        var method = givenSharedStaticMethod({
//            rest: {
//                before: createHook('beforeRest'),
//                after: createHook('afterRest')
//            }
//        });
//
//        objects.before(method.name, createHook('beforeRemote'));
//        objects.after(method.name, createHook('afterRemote'));
//
//        json(method.url)
//            .end(function(err) {
//                if (err) done(err);
//                assert.deepEqual(
//                    hooksCalled,
//                    ['beforeRest', 'beforeRemote', 'afterRemote', 'afterRest']
//                );
//                done();
//            });
//
//        function createHook(name) {
//            return function(ctx, next) {
//                hooksCalled.push(name);
//                next();
//            };
//        }
//    });

        describe('uncaught errors', function () {
            it('should return 500 if an error object is thrown', function (done) {
                var method = setupAndGivenSharedStaticMethod(
                    function bar(fn) {
                        throw new Error('an error');
                        fn(null);
                    }
                );

                json('get', method.url + '?a=1&b=2')
                    .expect(500)
                    .end(expectErrorResponseContaining({message: 'an error'}, done));
            });

            it('should return 500 if an error string is thrown', function (done) {
                var method = setupAndGivenSharedStaticMethod(
                    function bar(fn) {
                        throw 'an error';
                        fn(null);
                    }
                );

                json('get', method.url + '?a=1&b=2')
                    .expect(500)
                    .end(expectErrorResponseContaining({message: 'an error'}, done));
            });
        });


        it('should return 500 when method returns an error', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function (cb) {
                    cb(new Error('test-error'));
                }
            );

            // Send a plain, non-json request to make sure the error handler
            // always returns a json response.
            request(app).get(method.url)
                .expect('Content-Type', /json/)
                .expect(500)
                .end(expectErrorResponseContaining({message: 'test-error'}, done));
        });

        it('should return 500 when "before" returns an error', function (done) {
            var method = setupAndGivenSharedStaticMethod();
            sapp.remotes.before(method.name, function (ctx, next) {
                next(new Error('test-error'));
            });

            json(method.url)
                .expect(500)
                .end(expectErrorResponseContaining({message: 'test-error'}, done));
        });

        it('should return 500 when "after" returns an error', function (done) {
            var method = setupAndGivenSharedStaticMethod();
            sapp.remotes.after(method.name, function (ctx, next) {
                next(new Error('test-error'));
            });

            json(method.url)
                .expect(500)
                .end(expectErrorResponseContaining({message: 'test-error'}, done));
        });

        it('should return 400 when a required arg is missing', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function (a, cb) {
                    cb();
                },
                {
                    accepts: [
                        { arg: 'a', type: 'number', required: true }
                    ]
                }
            );

            json(method.url)
                .expect(400, done);
        });
    });

    it('returns 404 for unknown method of a shared class', function (done) {
        var classUrl = setupAndGivenSharedStaticMethod().classUrl;

        json(classUrl + '/unknown-method')
            .expect(404, done);
    });

    it('returns 404 with standard JSON body for unknown URL', function (done) {
        json('/unknown-url')
            .expect(404)
            .end(expectErrorResponseContaining({status: 404}, done));
    });

    it('returns correct error response body', function (done) {
        function TestError() {
            Error.captureStackTrace(this, TestError);
            this.name = 'TestError';
            this.message = 'a test error';
            this.status = 444;
            this.aCustomProperty = 'a-custom-value';
        }

        inherits(TestError, Error);

        var method = setupAndGivenSharedStaticMethod(function (cb) {
            cb(new TestError());
        });

        json(method.url)
            .expect(444)
            .end(function (err, result) {
                if (err) done(err);
                t.property(result.body, 'error');
                var expected = {
                    name: 'TestError',
                    status: 444,
                    message: 'a test error',
                    aCustomProperty: 'a-custom-value'
                };
                for (var prop in expected) {
                    t.deepEqual(result.body.error[prop], expected[prop]);
                }
//                t.include(result.body.error.stack, __filename);
                done();
            });
    });

    describe('cancelable', function () {

        it('should work with future and without cancel', function (done) {
            var method = setupAndGivenSharedStaticMethod(
                function cancelable(deferred, cb) {
                    setTimeout(function () {
                        cb(null, 'hello');
                    }, 200);

                    deferred.canceled(function () {
                        t.fail();
                    });
                },
                {
                    accepts: { arg: 'deferred', type: 'object', source: 'deferred' },
                    returns: { arg: 'msg', type: 'string' }
                }
            );
            json(method.url)
                .expect(200, { msg: 'hello' }, done);
        });

        it('should cancel when request abort', function (done) {

            var method = setupAndGivenSharedStaticMethod(
                function cancelable(deferred, cb) {
                    var h = setTimeout(function () {
                        t.fail();
                    }, 200);

                    deferred.canceled(function () {
                        clearTimeout(h);
                        done();
                    });
                },
                {
                    accepts: { arg: 'deferred', type: 'object', source: 'deferred' },
                    returns: { arg: 'msg', type: 'string' }
                }
            );

            var req = json(method.url).end(t.fail);
            setTimeout(function () { req.abort(); }, 100);
        });
    });

});


function createSapp(fns, cb) {
    var sapp = sycle();
    sapp.set('remoting', {json: {limit: '1kb'}});
    if (fns) {
        fns = Array.isArray(fns) ? fns : [fns];
        fns.forEach(function (fn) {
            fn(sapp);
        })
    }
    sapp.phase(sycle.boot.database());
    sapp.boot(function (err) {
        cb(err, sapp);
    });
    return sapp;
}

function givenSharedStaticMethod(sapp, fn, config) {
    if (typeof fn === 'object' && config === undefined) {
        config = fn;
        fn = null;
    }
    fn = fn || function (cb) {
        cb();
    };

    sapp.registry.define('testClass', {}, function (testClass) {
        testClass.testMethod = fn;
        testClass.expose('testMethod', config);
    });

    return {
        name: 'testClass.testMethod',
        url: '/testclasses/testMethod',
        classUrl: '/testclasses'
    };
}

function expectErrorResponseContaining(keyValues, done) {
    return function (err, resp) {
        if (err) return done(err);
        for (var prop in keyValues) {
            t.propertyVal(resp.body.error, prop, keyValues[prop]);
        }
        done();
    }
}