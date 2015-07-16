"use strict";

var s = require('./support');
var t = s.t;
var request = require('supertest');
var rest = require('../lib/rest');

describe('rest middleware', function () {

    beforeEach(s.setup(function (sapp) {
        sapp.registry.define('MyModel', {
            crud: true,
            properties: {name: String}
        });
    }));

    it('works out-of-the-box', function (done) {
        var app = this.app;
        app.use(rest(this.sapp));
        request(app).get('/mymodels')
            .expect(200)
            .end(done);
    });

    it('should report 404 for GET /:id not found', function (done) {
        var app = this.app;
        app.use(rest(this.sapp));
        request(app).get('/mymodels/1')
            .expect(404)
            .end(done);
    });

    it('should report 404 for HEAD /:id not found', function (done) {
        var app = this.app;
        app.use(rest(this.sapp));
        request(app).head('/mymodels/1')
            .expect(404)
            .end(done);
    });

    it('should report 200 for GET /:id found', function (done) {
        var app = this.app;
        app.use(rest(this.sapp));
        this.MyModel.create({name: 'm1'}, function (err, inst) {
            request(app).get('/mymodels/' + inst.id)
                .expect(200)
                .end(done);
        });
    });

    it('should report 200 for HEAD /:id found', function (done) {
        var app = this.app;
        app.use(rest(this.sapp));
        this.MyModel.create({name: 'm2'}, function (err, inst) {
            request(app).head('/mymodels/' + inst.id)
                .expect(200)
                .end(done);
        });
    });

});