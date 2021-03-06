// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const Tp = require('thingpedia');

// Pipe channels are a simple unidirectional communication primitive
// Push stuff to a sink pipe, same stuff comes out of the corresponding
// source pipe
// (unidirectional here means that you open them as sources or sinks
// and accordingly it varies what you can do with it - but just like
// Unix FIFOs and Windows named pipes, you can open the same name twice
// and read and write the same data)
//
// The power of pipe channels, in addition to simple chaining of apps
// locally, is that they work across tiers seamlessly, thanks to
// the coordination of PipeManager

// A PipeSinkChannel is the sink end of a pipe
// It has a list of sources it pushes events to
const PipeSinkChannel = new Tp.ChannelClass({
    Name: 'PipeSinkChannel',

    _init: function(name, pipeManager) {
        this.parent();

        this._name = name;
        this._pipeManager = pipeManager;

        this._sources = [];
        this.uniqueId = 'pipe-' + name + '-sink';
    },

    addSource: function(source) {
        this._sources.push(source);
    },

    removeSource: function(source) {
        this._sources = this._sources.filter(function(s) {
            return s !== source;
        });
    },

    hasSources: function() {
        return this._sources.length > 0;
    },

    sendEvent: function(event) {
        setTimeout(function() {
            this._sources.forEach(function(source) {
                source.emitEvent(event);
            });
        }.bind(this), 0);
    },

    // Opening the sink side does nothing, the event goes into
    // the void until someone subscribes to it
    _doOpen: function() {
        return Q();
    },

    _doClose: function() {
        this._pipeManager.removeSink(this._name);
        return Q();
    }
});

// A PipeProxySourceChannel is the source end of a pipe, when
// created by ProxyManager in response to a remote request for a pipe
// It does nothing: PipeSinkChannel calls emitEvent() on it when it
// has new data, and ChannelStub listens to the emitEvent() calls forwarding
// that data down to the remote side
const PipeProxySourceChannel = new Tp.ChannelClass({
    Name: 'PipeProxySourceChannel',

    _init: function(name, pipeManager) {
        this.parent();
        this._name = name;
        this._pipeManager = pipeManager;
        this.uniqueId = 'pipe-' + name + '-source';
    },

    // Opening a PipeProxySourceChannel does nothing, the bulk of
    // networking is done by ChannelStub/ProxyManager
    _doOpen: function() {
        return Q();
    },

    _doClose: function() {
        this._pipeManager.removeSource(this._name, this);
        return Q();
    }
});

// A PipeLocalSourceChannel is the source end of a pipe, when
// created by PipeManager for a local source pipe request
// It knows of multiple ProxyChannels and listens to them for source
// data
const PipeLocalSourceChannel = new Tp.ChannelClass({
    Name: 'PipeLocalSourceChannel',

    _init: function(name, pipeManager, proxies) {
        this.parent();

        this._name = name;
        this._pipeManager = pipeManager;

        this._proxies = proxies;
        proxies.forEach(function(p) {
            p.on('data', function(event) {
                this.emitEvent(event);
            }.bind(this));
        }, this);

        this.uniqueId = 'pipe-' + name + '-source';
    },

    _doOpen: function() {
        return Q.all(this._proxies.map(function(p) {
            return p.open();
        }));
    },

    _doClose: function() {
        return Q.all(this._proxies.map(function(p) {
            return p.close();
        })).then(function() {
            this._pipeManager.removeSource(this._name, this);
        }.bind(this));
    }
});

module.exports = class PipeManager {
    constructor(tierManager, proxyManager) {
        this._tierManager = tierManager;
        this._proxyManager = proxyManager;

        this._pipeSinks = {};
        this._pipeLocalSources = {};
        this._pipeProxySources = {};
    }

    removeSink(name) {
        delete this._pipeSinks[name];
    }

    removeSource(name, source) {
        if (this._pipeProxySources[name] === source)
            delete this._pipeProxySources[name];
        if (this._pipeLocalSources[name] === source)
            delete this._pipeLocalSources[name];
        if (name in this._pipeSinks)
            this._pipeSinks[name].removeSource(source);
    }

    getProxyNamedPipe(name) {
        if (name in this._pipeProxySources)
            return Q(this._pipeProxySources[name]);

        var proxyPipe = new PipeProxySourceChannel(name, this);
        this._pipeProxySources[name] = proxyPipe;

        if (name in this._pipeSinks)
            this._pipeSinks[name].addSource(proxyPipe);

        return proxyPipe;
    }

    getLocalSourceNamedPipe(name) {
        if (name in this._pipeLocalSources)
            return Q(this._pipeLocalSources[name]);

        var proxies = this._tierManager.getOtherTiers().map(function(tier) {
            return this._proxyManager.getProxyChannel('pipe-' + name + '-source', tier,
                                                      'thingengine-pipe-system', name, 'r', []);
        }.bind(this));
        var sourcePipe = new PipeLocalSourceChannel(name, this, proxies);
        this._pipeLocalSources[name] = sourcePipe;

        if (name in this._pipeSinks)
            this._pipeSinks[name].addSource(sourcePipe);

        return sourcePipe;
    }

    getLocalSinkNamedPipe(name) {
        if (name in this._pipeSinks)
            return Q(this._pipeSinks[name]);

        var sinkPipe = new PipeSinkChannel(name, this);
        if (name in this._pipeLocalSources)
            sinkPipe.addSource(this._pipeLocalSources[name]);
        if (name in this._pipeProxySources)
            sinkPipe.addSource(this._pipeProxySources[name]);
        this._pipeSinks[name] = sinkPipe;

        return sinkPipe;
    }
}

