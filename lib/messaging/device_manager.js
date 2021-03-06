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
const Ast = ThingTalk.Ast;

const DeviceView = require('../devices/device_view');

// This module observes the addition and removal of messaging devices,
// and controls the lifetime of additional modules that depend on
// a specific messaging device

// It also provides an implementation of the Messaging interface
// based on whatever is the current device
// (which fails with Error('Device Not Available') if there is no
// configured messaging device
module.exports = class MessagingDeviceManager extends Tp.Messaging {
    constructor(devices) {
        super();
        this._messagingDevice = null;
        this._messagingIface = null;

        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);
        this._feedChangedListener = this._onFeedChanged.bind(this);

        // @(type="messaging")
        var sel = Ast.Selector.Attributes([Ast.Attribute('type', Ast.Value.String('messaging'))]);
        this._view = new DeviceView(devices, sel);
    }

    get device() {
        return this._messagingDevice;
    }

    get isAvailable() {
        return this._messagingIface !== null;
    }

    _checkAvailable() {
        if (this._messagingIface === null)
            throw new Error('Device Not Available');
    }

    getOwnId() {
        this._checkAvailable();
        return this._messagingIface.getOwnId();
    }

    getUserById(id) {
        this._checkAvailable();
        return this._messagingIface.getUserById(id);
    }

    getAccountById(id) {
        this._checkAvailable();
        return this._messagingIface.getAccountById(id);
    }

    getFeedList() {
        if (this._messagingIface === null)
            return Q([]);
        else
            return this._messagingIface.getFeedList();
    }

    getFeedMetas() {
        if (this._messagingIface === null)
            return Q([]);
        else
            return this._messagingIface.getFeedMetas();
    }

    getFeedMeta(feedId) {
        this._checkAvailable();
        return this._messagingIface.getFeedMeta(feedId);
    }

    getFeed(feedId) {
        this._checkAvailable();
        return this._messagingIface.getFeed(feedId);
    }

    createFeed() {
        this._checkAvailable();
        return this._messagingIface.createFeed();
    }

    getFeedWithContact(contactId) {
        this._checkAvailable();
        return this._messagingIface.getFeedWithContact(contactId);
    }

    _onFeedAdded(feed) {
        this.emit('feed-added', feed);
    }

    _onFeedRemoved(feed) {
        this.emit('feed-removed', feed);
    }

    _onFeedChanged(feed) {
        this.emit('feed-changed', feed);
    }

    _tryAddMessagingDevice(device) {
        this._messagingDevice = device;
        var iface = device.queryInterface('messaging');
        this._messagingIface = iface;

        console.log('Found Messaging Device ' + device.uniqueId);

        return iface.start().then(() => {
            return iface.getFeedList();
        }).then(function(feeds) {
            iface.on('feed-added', this._feedAddedListener);
            iface.on('feed-removed', this._feedRemovedListener);
            iface.on('feed-changed', this._feedChangedListener);

            feeds.forEach(function(feedId) {
                this.emit('feed-added', feedId);
            }, this);
        }.bind(this));
    }

    _closeMessagingDevice() {
        this._messagingIface.removeListener('feed-added', this._feedAddedListener);
        this._messagingIface.removeListener('feed-removed', this._feedRemovedListener);
        this._messagingIface.removeListener('feed-changed', this._feedChangedListener);

        console.log('Lost Messaging Device ' + this._messagingDevice.uniqueId);

        var iface = this._messagingIface;

        iface.getFeedList().then((feeds) => {
            feeds.forEach(function(feedId) {
                this.emit('feed-removed', feedId);
            }, this);
        }).then(() => {
            return iface.stop();
        }).done();
    }

    _tryFindMessagingDevice() {
        var messagingDevices = this._view.values();
        if (messagingDevices.length == 0)
            return Q();
        return this._tryAddMessagingDevice(messagingDevices[0]);
    }

    _onDeviceAdded(device) {
        if (this._messagingDevice !== null)
            return;
        this._tryAddMessagingDevice(device).done();
    }

    _onDeviceRemoved(device) {
        if (this._messagingDevice !== device)
            return;

        this._closeMessagingDevice();
        this._messagingIface = null;
        this._messagingDevice = null;
        this._tryFindMessagingDevice().done();
    }

    start() {
        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this._view.on('object-added', this._deviceAddedListener);
        this._view.on('object-removed', this._deviceRemovedListener);
        this._view.start();

        return this._tryFindMessagingDevice();
    }

    stop() {
        this._view.removeListener('object-added', this._deviceAddedListener);
        this._view.removeListener('object-removed', this._deviceRemovedListener);
        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        this._view.stop();
        return Q();
    }
}
module.exports.prototype.$rpcMethods = ['get isAvailable', 'getOwnId', 'getUserById', 'getAccountById',
                                        'getFeedMetas', 'getFeedMeta'];
