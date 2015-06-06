"use strict";

var extend = require('util')._extend;
var inherits = require('util').inherits;
var RemoteObjects = require('strong-remoting');
var SharedClass = RemoteObjects.SharedClass;
var SharedMethod = require('strong-remoting/lib/shared-method');
var rest = require('../lib/rest');
var Rest = rest.Rest;

var s = require('./support');
var t = s.t;

function someFunc() {
}

describe('Rest', function () {
    var remotes;

    beforeEach(function () {
        remotes = RemoteObjects.create();
    });

    describe('buildClasses()', function () {
        it('fills `name`', function () {
            remotes.exports.testClass = s.createSharedClass();
            var classes = buildRestClasses();
            t.propertyVal(classes[0], 'name', 'testClass');
        });

        it('fills `routes`', function () {
            remotes.exports.testClass = s.createSharedClass();
            remotes.exports.testClass.http = { path: '/test-class', verb: 'any' };

            var classes = buildRestClasses();

            t.deepEqual(classes[0].routes, [
                { path: '/test-class', verb: 'any' }
            ]);
        });

        it('fills `ctor`', function () {
            var testClass = remotes.exports.testClass = s.createSharedClass();
            testClass.sharedCtor.http = { path: '/shared-ctor', verb: 'all' };

            var classes = buildRestClasses();

            t.deepEqual(classes[0].ctor.routes, [
                { path: '/shared-ctor', verb: 'all' }
            ]);
        });

        it('fills static methods', function () {
            var testClass = remotes.exports.testClass = s.createSharedClass();
            testClass.staticMethod = extend(someFunc, { shared: true });

            var methods = buildRestClasses()[0].methods;

            t.lengthOf(methods, 1);
            t.propertyVal(methods[0], 'name', 'staticMethod');
            t.propertyVal(methods[0], 'fullName', 'testClass.staticMethod');
            t.deepPropertyVal(methods[0], 'routes[0].path', '/staticMethod');
        });

        it('fills prototype methods', function () {
            var testClass = remotes.exports.testClass = s.createSharedClass();
            testClass.prototype.instanceMethod = extend(someFunc, { shared: true });

            var methods = buildRestClasses()[0].methods;

            t.lengthOf(methods, 1);
            t.propertyVal(methods[0], 'fullName', 'testClass.prototype.instanceMethod');
            // Note: the `/id:` part is coming from testClass.sharedCtor
            t.deepPropertyVal(methods[0], 'routes[0].path', '/:id/instanceMethod');
        });

        function buildRestClasses() {
            return new Rest(remotes).buildClasses();
        }
    });


    describe('RestClass', function() {
        describe('getPath', function() {
            it('returns the path of the first route', function() {
                var restClass = givenRestClass({ http: [
                    { path: '/a-path' },
                    { path: '/another-path' }
                ]});
                t.equal(restClass.getPath(), '/a-path');
            });
        });

        function givenRestClass(config) {
            var ctor = s.createSharedClass(config);
            remotes.testClass = ctor;
            var sharedClass = new SharedClass('testClass', ctor);
            return new rest.RestClass(sharedClass);
        }
    });


    describe('RestMethod', function() {
        var anArg = { arg: 'an-arg-name', type: String };

        it('has `accepts`', function() {
            var method = givenRestStaticMethod({ accepts: anArg });
            t.deepEqual(method.accepts, [anArg]);
        });

        it('has `returns`', function() {
            var method = givenRestStaticMethod({ returns: anArg });
            t.deepEqual(method.returns, [anArg]);
        });

        it('has `description`', function() {
            var method = givenRestStaticMethod({ description: 'a-desc' });
            t.equal(method.description, 'a-desc');
        });

        describe('isReturningArray()', function() {
            it('returns true when there is single root Array arg', function() {
                var method = givenRestStaticMethod({
                    returns: { root: true, type: Array }
                });
                t.equal(method.isReturningArray(), true);
            });

            it('returns true when there is single root "array" arg', function() {
                var method = givenRestStaticMethod({
                    returns: { root: true, type: Array }
                });
                t.equal(method.isReturningArray(), true);
            });

            it('returns false otherwise', function() {
                var method = givenRestStaticMethod({
                    returns: { arg: 'result', type: Array }
                });
                t.equal(method.isReturningArray(), false);
            });

            it('handles invalid type', function() {
                var method = givenRestStaticMethod({
                    returns: { root: true }
                });
                t.equal(method.isReturningArray(), false);
            });
        });

        describe('acceptsSingleBodyArgument()', function() {
            it('returns true when the arg is a single Object from body', function() {
                var method = givenRestStaticMethod({
                    accepts: {
                        arg: 'data',
                        type: Object,
                        http: { source: 'body' }
                    }
                });
                t.equal(method.acceptsSingleBodyArgument(), true);
            });

            it('returns false otherwise', function() {
                var method = givenRestStaticMethod({
                    accepts: { arg: 'data', type: Object }
                });
                t.equal(method.acceptsSingleBodyArgument(), false);
            });
        });

        describe('getHttpMethod', function() {
            it('returns POST for `all`', function() {
                var method = givenRestStaticMethod({ http: { verb: 'all'} });
                t.equal(method.getHttpMethod(), 'POST');
            });

            it('returns DELETE for `del`', function() {
                var method = givenRestStaticMethod({ http: { verb: 'del'} });
                t.equal(method.getHttpMethod(), 'DELETE');
            });

            it('returns upper-case value otherwise', function() {
                var method = givenRestStaticMethod({ http: { verb: 'get'} });
                t.equal(method.getHttpMethod(), 'GET');
            });
        });

        describe('getPath', function() {
            it('returns the path of the first route', function() {
                var method = givenRestStaticMethod({ http: [
                    { path: '/a-path' },
                    { path: '/another-path' }
                ]});
                t.equal(method.getPath(), '/a-path');
            });
        });

        describe('getFullPath', function() {
            it('returns class path + method path', function() {
                var method = givenRestStaticMethod(
                    { http: { path: '/a-method' } },
                    { http: { path: '/a-class' } }
                );

                t.equal(method.getFullPath(), '/a-class/a-method');
            });
        });

        function givenRestStaticMethod(methodConfig, classConfig) {
            var name = 'testMethod';
            methodConfig = extend({ shared: true }, methodConfig);
            classConfig = extend({ shared: true}, classConfig);
            remotes.testClass = extend({}, classConfig);
            var fn = remotes.testClass[name] = extend(function(){}, methodConfig);

            var sharedClass = new SharedClass('testClass', remotes.testClass, true);
            var restClass = new rest.RestClass(sharedClass);

            var sharedMethod = new SharedMethod(fn, name, sharedClass, methodConfig);
            return new rest.RestMethod(restClass, sharedMethod);
        }
    });


    describe('sortRoutes', function() {
        it('should sort routes based on verb & path', function() {
            var routes = [
                {route: {verb: 'get', path: '/'}},
                {route: {verb: 'get', path: '/:id'}},
                {route: {verb: 'get', path: '/findOne'}},
                {route: {verb: 'delete', path: '/'}},
                {route: {verb: 'del', path: '/:id'}}
            ];

            routes.sort(rest.sortRoutes);

            t.deepEqual(routes, [
                {route: {verb: 'get', path: '/findOne'}},
                {route: {verb: 'get', path: '/:id'}},
                {route: {verb: 'get', path: '/'}},
                {route: {verb: 'del', path: '/:id'}},
                {route: {verb: 'delete', path: '/'}}
            ]);

        });

        it('should sort routes based on path accuracy', function() {
            var routes = [
                {route: {verb: 'get', path: '/'}},
                {route: {verb: 'get', path: '/:id/docs'}},
                {route: {verb: 'get', path: '/:id'}},
                {route: {verb: 'get', path: '/findOne'}}
            ];

            routes.sort(rest.sortRoutes);

            t.deepEqual(routes, [
                {route: {verb: 'get', path: '/findOne'}},
                {route: {verb: 'get', path: '/:id/docs'}},
                {route: {verb: 'get', path: '/:id'}},
                {route: {verb: 'get', path: '/'}}
            ]);

        });

        it('should sort routes with common parts', function() {
            var routes = [
                {route: {verb: 'get', path: '/sum'}},
                {route: {verb: 'get', path: '/sum/1'}}
            ];

            routes.sort(rest.sortRoutes);

            t.deepEqual(routes, [
                {route: {verb: 'get', path: '/sum/1'}},
                {route: {verb: 'get', path: '/sum'}}
            ]);

        });

        it('should sort routes with trailing /', function() {
            var routes = [
                {route: {verb: 'get', path: '/sum/'}},
                {route: {verb: 'get', path: '/sum/1'}}
            ];

            routes.sort(rest.sortRoutes);

            t.deepEqual(routes, [
                {route: {verb: 'get', path: '/sum/1'}},
                {route: {verb: 'get', path: '/sum/'}}
            ]);

        });
    });
});