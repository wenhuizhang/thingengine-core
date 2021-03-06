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
const ThingTalk = require('thingtalk');
const Tier = Tp.Tier;
const Protocol = require('../tiers/protocol');
const ChannelStateDatabase = require('../db/channel');
const RefCounted = require('../util/ref_counted');

class ChannelStateBinder extends RefCounted {
    constructor(db) {
        super();
        this._db = db;
        this._cached = {};
        this.uniqueId = null;
        this._updateTimeout = null;
    }

    init(uniqueId) {
        this.uniqueId = uniqueId;
    }

    get(name) {
        return this._cached[name];
    }

    set(name, value) {
        this._cached[name] = value;

        clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(this._flushToDisk.bind(this), 500);
    }

    _flushToDisk() {
        this._updateTimeout = null;

        return this._db.insertOne(this.uniqueId, this._cached);
    }

    _doOpen() {
        return this._db.getOne(this.uniqueId).then(function(value) {
            if (value !== null)
                this._cached = value;
            else
                this._cached = {};
        }.bind(this));
    }

    _doClose() {
        clearTimeout(this._updateTimeout);
        return this._flushToDisk();
    }
}

module.exports = class ChannelFactory {
    constructor(engine, devices) {
        this._engine = engine;
        this._cachedChannels = {};

        this._devices = devices;
        this._proxyManager = null;

        this._db = new ChannelStateDatabase(engine.platform);
    }

    set proxyManager(v) {
        this._proxyManager = v;
    }

    _onDeviceRemoved(device) {
        var prefix = device.uniqueId + '-';
        for (var key in this._cachedChannels) {
            if (key.startsWith(prefix))
                delete this._cachedChannels[key];
        }
    }

    start() {
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this._devices.on('object-removed', this._deviceRemovedListener);
        return Q();
    }

    stop() {
        this._devices.removeListener('object-removed', this._deviceRemovedListener);
        return Q();
    }

    _getProxyChannel(targetTier, device, kind, mode, params) {
        var targetChannelId = device.uniqueId + '-' + kind;
        if (mode === 'r')
            targetChannelId += '-' + Protocol.params.makeString(params);

        return this.getChannel(device, kind, mode, params, false).then((local) => {
            return this._proxyManager.getProxyChannel(targetChannelId, targetTier,
                                                      device, local, kind, mode, params);
        });
    }

    _checkFactoryCaps(caps) {
        return caps.every(function(c) {
            if (c === 'channel-state')
                return true;
            else
                return this._engine.platform.hasCapability(c);
        }.bind(this));
    }

    getChannel(device, kind, mode, params, forOpen) {
        return Q.try(function() {
            if (mode === 'r')
                return device.getTriggerClass(kind);
            else if (mode === 'q')
                return device.getQueryClass(kind);
            else
                return device.getActionClass(kind);
        }).then(function(factory) {
            var caps = factory.requiredCapabilities || [];
            if (forOpen && !this._checkFactoryCaps(caps))
                throw new Error('Channel is not supported');

            var hasState = caps.indexOf('channel-state') >= 0;
            var channel;
            var state;
            if (hasState) {
                state = new ChannelStateBinder(this._db);

                if (typeof factory === 'function') {
                    channel = new factory(this._engine, state, device, params);
                } else {
                    channel = factory.createChannel(this._engine, state, device, params);
                }
            } else {
                state = null;

                if (typeof factory === 'function') {
                    channel = new factory(this._engine, device, params);
                } else {
                    channel = factory.createChannel(this._engine, device, params);
                }
            }

            if (channel.filterString !== undefined)
                channel.uniqueId = device.uniqueId + '-' + kind + '-' + channel.filterString;
            else
                channel.uniqueId = device.uniqueId + '-' + kind;

            console.log('Obtained channel ' + channel.uniqueId);

            // deduplicate the channel now that we have the uniqueId
            if (state) {
                state.init(channel.uniqueId);
                return state.open().then(() => {
                    if (channel.uniqueId in this._cachedChannels) {
                        return this._cachedChannels[channel.uniqueId];
                    } else {
                        state.close(); // ignore errors
                        return this._cachedChannels[channel.uniqueId] = channel;
                    }
                });
            } else {
                if (channel.uniqueId in this._cachedChannels) {
                    return this._cachedChannels[channel.uniqueId];
                } else {
                    return this._cachedChannels[channel.uniqueId] = channel;
                }
            }
        }.bind(this));
    }

    _getOpenedChannel(promise) {
        return Q(promise).tap(function(channel) {
            return channel.open();
        });
    }

    getOpenedChannel(device, id, mode, params) {
        if (device.ownerTier === this._engine.ownTier ||
            device.ownerTier === Tier.GLOBAL)
            return this._getOpenedChannel(this.getChannel(device, id, mode, params, true));
        else
            return this._getOpenedChannel(this._getProxyChannel(device.ownerTier, device, id, mode, params));
    }
}
