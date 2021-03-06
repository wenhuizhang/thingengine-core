// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'GetRandomChannel',

    formatEvent(event) {
        var number = event[0];
        return String(number);
    },

    invokeQuery(filters) {
        return [[Math.random()]];
    }
});
