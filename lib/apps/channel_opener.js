// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ObjectSet = require('../util/object_set');
const DeviceView = require('../devices/device_view');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

// the device that owns/implements a builtin
const BuiltinOwner = {
    'timer': 'thingengine-own-global',
    'at': 'thingengine-own-global',
    'input': 'thingengine-app',
    'return': 'thingengine-app',
    'notify': 'thingengine-app',
    'logger': 'thingengine-pipe-system'
};

// The named pipe system, wrapped as a device-like to appease ChannelOpener
class PipeSystemDevice {
    constructor(engine) {
        this.engine = engine;
    }

    getTrigger(id, params) {
        return this.engine.channels.getNamedPipe('thingengine-system-' + id, 'r');
    }

    getAction(id) {
        return this.engine.channels.getNamedPipe('thingengine-system-' + id, 'w');
    }
}

module.exports = class ChannelOpener extends ObjectSet.Base {
    constructor(engine, app, mode, selector, channelName, params) {
        super();

        this.engine = engine;
        this.app = app;
        this._mode = mode;
        this._normalizeSelector(selector, channelName);
        this._params = params || [];

        this._set = new ObjectSet.Simple();
        this._set.on('object-added', (o) => this.objectAdded(o));
        this._set.on('object-removed', (o) => this.objectRemoved(o));
    }

    values() {
        return this._set.values();
    }

    start() {
        this._view.start();
        this._view.on('object-added', this._onDeviceAdded.bind(this));
        this._view.on('object-removed', this._onDeviceRemoved.bind(this));

        return this._openChannels();
    }

    stop() {
        this._view.stop();
        return this._closeChannels();
    }

    _openChannels() {
        var devices = this._view.values();
        var promises = devices.map(function(device) {
            return this._openOneChannel(device);
        }.bind(this));

        return Q.all(promises);
    }

    _closeChannels() {
        var removed = this._set.removeAll();

        return Q.all(removed.map(function(ch) {
            return ch.close();
        }));
    }

    _normalizeSelector(selector, channelName) {
        if (selector.isBuiltin) {
            var owner = BuiltinOwner[selector.name];

            // all builtins are special, but some are more special than others [semicit]
            if (owner === 'thingengine-app') {
                // builtins "owned" by thingengine-app in particular are really owned by
                // the app that is constructing this opener
                this._view = new ObjectSet.Simple();
                this._view.addOne(this.app);
            } else if (owner === 'thingengine-pipe-system') {
                // builtins "owned" by thingengine-pipe-system are just, well, pipes
                this._view = new ObjectSet.Simple();
                this._view.addOne(new PipeSystemDevice(this.engine));
            } else {
                this._view = new DeviceView(this.engine.devices, Ast.Selector.Id(owner))
            }

            this._channelName = selector.name;
        } else if (selector.isComputeModule) {
            this._view = new ObjectSet.Simple();
            this._view.addOne(this.app.getComputeModule(selector.module));
            this._channelName = channelName;
        } else {
            this._view = new DeviceView(this.engine.devices, selector);
            this._channelName = channelName;
        }
    }

    _openOneChannel(device) {
        // try to open the device
        var promise;
        if (this._mode === 'r')
            promise = device.getTrigger(this._channelName, this._params);
        else if (this._mode === 'q')
            promise = device.getQuery(this._channelName);
        else if (this._mode === 'w')
            promise = device.getAction(this._channelName);
        else
            throw new TypeError('Invalid mode');

        return this._set.addOne(promise);
    }

    _onDeviceAdded(device) {
        this._openOneChannel(device).catch((e) => {
            console.error('Failed to get channel ' + this._channelName +
                          ' in device ' + device.uniqueId + ': ' + e.message);
            console.error(e.stack);
            return null;
        }).done();
    }

    _onDeviceRemoved(device) {
        var removed = this._set.removeIf(function(ch) {
            return ch.uniqueId.startsWith(device.uniqueId + '-');
        });

        Q.all(removed.map(function(ch) {
            return ch.close();
        })).catch(function(e) {
            console.error('Failed to close channels for device ' + device.uniqueId + ': ' + e.message);
        }).done();
    }
}