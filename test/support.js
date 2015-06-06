"use strict";

var t = exports.t = require('chai').assert;
var extend = require('util')._extend;
var express = require('express');
var sycle = require('sycle');

exports.setup = function setup(fns) {
    return function (done) {
        var test = this;
        exports.createSapp(fns, function (err, sapp) {
            test.sapp = sapp;
            for(var name in sapp.models) test[name] = sapp.models[name];
            test.app = express();
            done();
        });
    }
};

exports.createSapp = function createSapp(fns, cb) {
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
};

exports.createSharedClass =  function createSharedClass(config) {
    // create a class that can be remoted
    var SharedClass = function(id) {
        this.id = id;
    };
    extend(SharedClass, config);

    SharedClass.shared = true;

    SharedClass.sharedCtor = function(id, cb) {
        cb(null, new SharedClass(id));
    };

    extend(SharedClass.sharedCtor, {
        shared: true,
        accepts: [ { arg: 'id', type: 'any', http: { source: 'path' }}],
        http: { path: '/:id' },
        returns: { root: true }
    });

    return SharedClass;
};

