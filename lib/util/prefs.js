// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const fs = require('fs');

class Preferences {
    // Retrieve the named preference, or undefined if there is no stored value for it
    get(name) {
        return undefined;
    }

    // Set the named preference to the given value, which can be any object for which
    // a valid JSON representation exists (any non-cyclic object without non enumerable
    // properties)
    set(name, value) {
        throw new Error('Abstract method');
    }
}

// Simple implementation of Preferences that uses a single file
class FilePreferences extends Preferences {
    constructor(file, writeTimeout) {
        super();
        this._file = file;
        this._writeTimeout = writeTimeout === undefined ? 100 : writeTimeout;
        try {
            this._prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch(e) {
            if (e.name === 'SyntaxError')
                console.error('Syntax error loading preference file from disk: ' + e.message);
            else if (e.code !== 'ENOENT')
                throw e;
        }
        if (!this._prefs) {
            this._prefs = {};
            this._scheduleWrite();
        }
        this._dirty = false;
        this._writeScheduled = false;
    }

    keys() {
        return Object.keys(this._prefs);
    }

    get(name) {
        return this._prefs[name];
    }

    set(name, value) {
        this._prefs[name] = value;
        this._scheduleWrite();
        return value;
    }

    delete(name) {
        delete this._prefs[name];
        this._scheduleWrite();
    }

    changed() {
        this._scheduleWrite();
    }

    flush() {
        if (!this._dirty)
            return Q();
        return Q.nfcall(fs.writeFile, this._file, JSON.stringify(this._prefs));
    }

    saveCopy(to) {
        return Q.nfcall(fs.writeFile, to, JSON.stringify(this._prefs));
    }

    _scheduleWrite() {
        this._dirty = true;
        if (this._writeScheduled)
            return;

        setTimeout(function() {
            this._writeScheduled = false;
            this.flush().done();
        }.bind(this), this._writeTimeout);
    }
}

module.exports = {
    Preferences: Preferences,
    FilePreferences: FilePreferences
};
