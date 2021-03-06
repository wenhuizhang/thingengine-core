# Writing Interfaces for Thingpedia

## The basics: Devices, Channels and Events

At the highest level, a Thingpedia interface is just a nodejs
package, whose main entry point is a _device class_.

From a device class, the system will obtain _device instances_,
which are the individual objects that represent things in
the system (we use "device" as a term in the code to mean both
physical devices and web services). A device instance contains
all the descriptors that are needed to identify the thing,
such as account ID or IP/MAC address, and contains any authentication
information.

From each device instance, when needed the system will obtain
_channels_. A channel is an abstraction over a trigger or an
action, which is represented as an open connection to the device.

A channel produces and handles _events_. These are just JS arrays of values
that are processed by the ThingTalk rules. A trigger channel will
produce new events to be handled by the rules, based on the data
obtained by the device. An action channel will consume an event
produced by a rule and turn into in an external action.

Channels can be opened and closed. For triggers, an open channel
is one that generates events, and a closed channel does not.
For actions, you can assume that invocations will only happen on
open channels, so you can release any resource during close.

You should never need to open or instantiate channels yourself.
Instead, you would set up your _channel class_ so that the system
will create and open the channels at the right time.

## The layout of a Device package

The Thingpedia API assumes a precise layout for a device package.

The primary entry point (i.e., the one named as "main" in package.json)
should be a _device class_. You would instantiate the device class
from the API and set it directly to `module.exports`, as in

    const Tp = require('thingpedia');

    module.exports = new Tp.DeviceClass({
        Name: "MyDeviceClass",

        _init: function(engine, state) {
             this.parent(engine, state);
             // constructor
        }

        // other methods of device class
    });

Then, for each trigger or action you want to expose, you would
have a separate JS file for each, named after the trigger or action,
exposing the channel class as `module.exports`. So for example, if
you want to expose action `.frobnicate()`, you would put the following
in a file named `frobnicate.js` at the toplevel of your device package:

    const Tp = require('thingpedia');

    module.exports = new Tp.ChannelClass({
        Name: "FrobnicateChannel",

        _init: function(engine, device) {
            this.parent();
            // constructor
        }

        // other methods of channel class
    });

Note: the `Name` you specify in the device and channel class is just
a debugging hint (your object will stringify to `[object YourName]`),
it has no real significance.

## Representing Devices

A device instance holds several pieces of data.

### _primary kind_ (or just kind)

The name of your nodejs package, and the unique identifier of your
device class that you will use to publish your device to Thingpedia;
you can access it as `this.kind` in your device class.

### _secondary kinds_

Additional types that your device class conforms to. If your device class
supports secondary kind `foo`, then a rule can refer to it as `@(type="foo")`.

The most important secondary kind is `online-account`, which will flag
the device as an account, and will change where it appears in the UI.

Other important secondary kinds are `cloud-only`, `phone-only` or `server-only`,
which will prevent your code from being instantiated outside of the right
ThingEngine installation.

### _state_

An arbitrary serializable JS object with data you will need
to talk to the device - including IP addresses, OAuth tokens, variable
portions of API urls, etc; you can access the state as `this.state` in your
device class.

There is no structure in the state object, with the following exceptions:

- `state.kind` must be the primary kind
- `state.tags` can be an array of user-defined tags
- if your device supports discovery, `state.discoveredBy` must be the tier
  (phone or server) that did the discovery (normally set to `this.engine.ownTier`)

### _unique ID_

A string that uniquely identifies the device instance
in the context of a given ThingEngine; you are supposed to compute it
based on the state and set `this.uniqueId` at the end of your
constructor

A common way to compute an unique ID is to concatenate the kind, a dash,
and then some device specific ID, as in `org.thingpedia.demos.thingtv-AA-BB-CC-DD-EE-FF`
if `AA:BB:CC:DD:EE:FF` is the MAC address of the ThingTV.

### _descriptors_

If your device supports local discovery, the descriptors
are identifiers obtained by the discovery protocol, such as `bluetooth-00-11-22-33-44-55`.

Discovery will be described further in a later section

## A closer look to the Device class

When you create a device class with `new Tp.DeviceClass`, you're actually declaring
a subclass of [`Tp.BaseDevice`](https://github.com/Stanford-IoT-Lab/thingpedia-api/blob/master/lib/base_device.js), the base class of all device classes.

By convention, members starting with a capital letter here are static, and members stating
with lower case are instance methods and variables. `Tp.BaseDevice` has you the following API:

- `this.uniqueId`, `this.state`, `this.kind`: provide access to the respective pieces
of device instance data
- `this.engine`: gives you access to the full Engine API
- `this.stateChanged()`: if you change `this.state`, you must at some point call `this.stateChanged`
to preserve the modification to disk
- `this.updateState(newState)`: conversely, if the state changes outside of you, and you
want to recompute state, you should override `updateState()` to handle the new state; the overriding
method should chain up (with `this.parent(newState)`) as the first statement
- `this.hasKind(kind)`: check if the device has the given kind (primary or secondary); the
default implementation has no secondary kinds, override it if you need it
- `Kinds`: an array of secondary kinds, which provides a quick way to implement `hasKind` if
you don't need dynamic behavior
- `UseOAuth2`: if your device can be instantiated with an OAuth-like flow (user clicks on a button,
is redirected to a login page), this should be set to the handler; despite the name, this is
called also for OAuth 1 or no authentication at all
- `UseDiscovery`, `this.updateFromDiscovery`: discovery operations, described later
- `this.queryInterface(iface)`: request an _extension interface_ for this device instance; extension
interfaces are optional features that your device class supports; override this method if you have
any, otherwise the default implementation will always return `null`.

## The Engine API

`this.engine` on a device gives you access to the
[`Engine`](https://github.com/Stanford-IoT-Lab/thingengine-core/blob/master/lib/engine.js)
object, which is shared among all device instances. The API on the
`Engine` object is less stable than `Tp.BaseDevice`, but it is
nevertheless useful.

- `engine.ownTier`: the currently running tier of ThingEngine, ie `cloud`, `phone` or `server`
- `engine.messaging`: gives you access to the primary messaging interface (or a dummy interface
that always fails if there is no messaging account)
- `engine.keywords`: the keyword database that holds the ThingTalk persistent data
- `engine.channels`: the factory class that instantiates channels and deduplicates them
- `engine.devices`: the devices database
- `engine.apps`: the apps database
- `engine.platform`: the Platform API

## The Platform API

Anywhere in ThingEngine code you will be able to access the Platform API through the `engine.platform`
property.

Most of the API is for internal use only, but you might find the following useful:

- `platform.hasCapability()`, `platform.getCapability()`: access
  platform specific APIs and capabilities, such as bluetooth,
  unzipping, showing popups or interacting with the assistant
- `platform.getSharedPreferences()`: access an instance of
[`Preferences`](https://github.com/Stanford-IoT-Lab/thingengine-core/blob/master/lib/prefs.js),
which is a ThingEngine wide store of key-value pairs backed to disk
- `platform.getRoot()`, `platform.getWritableDir()`,
`platform.getCacheDir()`, `platform.getTmpDir()`: the paths that
ThingEngine can use on the file system
- `platform.getDeveloperKey()`: the currently configured Thingpedia developer key (if any)
- `platform.getOrigin()`: the web site hosting ThingEngine

## Extension Interfaces and Messaging

As mentioned before, `device.queryInterface()` can be used to retrieve
extension interfaces for a device class. The most important extension
interface is
[`messaging`](https://github.com/Stanford-IoT-Lab/thingpedia-api/blob/master/lib/messaging.js),
which is implemented by all devices that implement some sort of messaging layer, like Omlet
or (hypothetically) Facebook Messenger or Telegram.

If your device implements `messaging`, it becomes a candidate for being the primary messaging
interface (the one exposed by `engine.messaging`), which is used by ThingTalk to implement
feed shared keywords. In practice, only Omlet should implement `messaging`.

Conversely, if you obtain a messaging device (for example with `engine.devices.getAllDevicesOfKind('messaging')`) you can use its messaging interface to send and receive messages on behalf
of the user.

## Handling Authentication

### Different types of authentication

Most devices will require some kind of authentication, for example a password or an OAuth 2.0
access token. After the device is set up and stored to disk, this is easy because you have
the authentication data, but you need a way to obtain it at first.

The way it is handled is through the `auth` field in the _manifest file_, which describes
the device metadata in Thingpedia and is used to generate the UI show in ThingEngine. The
manifest will be described in more detail later.

Three ways to do authentication are supported:

- `none`: means that the device has no authentication at all, it only uses publicly available APIs;
the resulting configuration UI will be a single button (unless you need other data,
in which case it will be a form)
- `basic`: traditional username and password; your state must contain `username` and `password`
properties, which are set to the values provided by the user through a form
- `oauth2`: OAuth 1.0 and 2.0 style authentication; the user clicks and is redirected to a login
page, then the login page redirects back to ThingEngine giving you the authorization code

If your device uses `none` or `oauth2` authentication, it must
implement the `UseOAuth2(engine, req)` class method.

For `none` authentication, you would just add yourself as a new device, filling in whatever
state variables you need, as in:

    UseOAuth2: function(engine) {
        engine.devices.loadOneDevice({ kind: 'com.example.mydevice', someother: 'state' }, true);
        return null;
    }

`true` indicates that the device should be saved to disk. `return null` indicates that the
authentication process is complete and there is no redirect.

### `oauth2` authentication the slow way

If your device uses OAuth-style authentication, you must implement `UseOAuth2` in your
device class.

This method will be called twice: the first time, the `req` argument (the second argument
to your function) will be `null`. You must do whatever preparation to access the remote
service and return a [Promise](https://www.promisejs.org/) of an array with two elements:

- first element is the full redirect URI of the authentication page
- second element is an object with any value you want to store in the user session

The OAuth call should be set to redirect to `platform.getOrigin() +
'/devices/oauth2/callback/' + `_your kind_. This means that you should
add `http://127.0.0.1:8080`, `http://127.0.0.1:3000` and
`https://thingengine.stanford.edu` as acceptable redirects in the
service console if the service has redirect URI validation.

In pseudo code, the first call looks like:

    UseOAuth2: function(engine, req) {
        if (req === null) {
            return prepareForOAuth2().then(function() {
                return ['https://api.example.com/1.0/authorize?redirect_uri=' +
                        platform.getOrigin() + '/devices/oauth2/callback/com.example',
                        { 'com-example-session': 'state' }];
            });
        } else {
            // handle the second phase of OAuth
        }
    }

The second time, `UseOAuth2` will be called with `req` set to a sanitized version of
the callback request generated by the service. Use `req.query` to access the query part
of the URL, `req.session` to read (but not write) the session.

During the second call, you can use the authentication code produced by the callback
to obtain the real access token, and then save it to the database. In pseudo-code:

    UseOAuth2: function(engine, req) {
        if (req === null) {
            // handle the first phase of OAuth
        } else {
            if (req.session['com-example-session'] !== 'state')
                throw new Error('Invalid state');
            return getAccessToken(req.query.code).then(function(accessToken, refreshToken) {
                return getProfile(accessToken).then(function(profile) {
                    return engine.devices.loadOneDevice({ kind: 'com.example',
                                                          accessToken: accessToken,
                                                          userId: profile.id });
                });
            });
        }
    }

### `oauth2` authentication helpers

As mentioned before, despite the name `oauth2` is the authentication type of
all OAuth style schemes. But if you use exactly OAuth 2.0 as specified in
[RFC 6749](https://tools.ietf.org/html/rfc6749), which some services do, you
can use a shorter helper:

    UseOAuth2: Tp.Helpers.OAuth2({
        kind: "com.example",
        client_id: "your_oauth2_client_id",
        client_secret: "your_oauth2_client_secret_encrypted_as_rot13",
        authorize: "https://api.example.com/1.0/authorize",
        scope: ['example_user_profile', 'example_basic_info']
        get_access_token: "https://api.example.com/1.0/token",
        callback: function(accessToken, refreshToken) { /* add device here */ }
    })

## Channel classes

Great, so now you filled up your device class, and the user can add the device from
the UI. Time to make some triggers and actions.

As mentioned, triggers and actions need channel classes, of the form:

    const Tp = require('thingpedia');

    module.exports = new Tp.ChannelClass({
        Name: 'MyChannel',
        RequiredCapabilities: [],

        _init: function(engine, device, params) {
        },

        _doOpen: function() {
            // open the channel
        },

        _doClose: function() {
            // close the channel
        }
    });

`_doOpen` and `_doClose` should return a promise that is ready when your channel is.
We don't provide a Promise library (and we're not running nodejs in ES6 mode), but we
encourage you include [Q](https://github.com/kriskowal/q) in your dependencies, because
that's what the rest of ThingEngine uses.

`RequiredCapabilities` is an array of platform capabilities that your channel requires
to work. If the platform does not have the capabilities you need, then your channel will
not be instantiated (and the engine will try to figure out a different way to run it,
for example through a proxy), so you don't have to check for them.

### Triggers

Triggers should call `this.emitEvent([a,b,c])` whenever they want to generate an event.
For example:

    const Tp = require('thingpedia');

    module.exports = new Tp.ChannelClass({
        Name: 'MyTrigger',

        _init: function(engine, device, params) {
            this.parent();
            this.timeout = null;
        },

        _doOpen: function() {
             this.timeout = setTimeout(function() { this.emitEvent(['bla']); }.bind(this), 5000);
        },

        _doClose: function() {
             clearTimeout(this.timeout);
             this.timeout = 1000;
        }
    });

When the values generated by the triggers are measurements, you must make use of
the base units defined in the [ThingTalk reference](/doc/thingtalk-reference.md).

### Actions

Actions on the other hand should override `sendEvent(event)` in the
channel class, as in:

    const Tp = require('thingpedia');

    module.exports = new Tp.ChannelClass({
        Name: 'MyAction',

        _init: function(engine, device, params) {
            this.parent();
        },

        sendEvent: function(event) {
            // do something
        },

        _doOpen: function() {
            // open the channel
        },

        _doClose: function() {
            // close the channel
        }
    });

A lot of times action channels do not require any set up or tear down,
in which case you can use `Tp.SimpleAction`:

    const Tp = require('thingpedia');

    module.exports = new Tp.ChannelClass({
        Name: 'MySimpleAction',
        Extends: Tp.SimpleAction

        _init: function(engine, device, params) {
            this.parent();
        },

        _doInvoke: function(arg1, arg2, ...) {
            // do something
        },
    });

### Partially applied triggers

It is possible that web services will support server side filtering of
event streams, which can reduce the number of wake ups required on
ThingEngine if the rule is also going to filter out the data.

To address some of those cases, rules that invoke a trigger with a
constant value will see those values propagated to the params argument
to the constructor, as an array of
[`ThingTalk.Value`s](https://github.com/Stanford-IoT-Lab/ThingTalk/blob/master/lib/ast.js)

If you make any use of that `params` argument, you should set
`this.filterString` in your constructor to a stringified version of
the parameters that you care about. This is needed to properly deduplicate
your channel across rules with different filter values.

### Stateful Channels

Often times, you will want to preserve state between different invocations
of your channel. Keeping it in memory is not enough though, because the
ThingEngine might be restarted at any time and the state would be lost.

Instead, you can require the `channel-state` capability (with `RequiredCapabilities: ['channel-state']`). If you do, the signature of your constructor becomes

    _init: function(engine, state, device, params)

The `state` object is persisted to disk, and has APIs:

- `state.get(key)`: return a state value
- `state.set(key, value)`: modify a state value

## Writing Triggers

So far we've looked at the most generic of all triggers, suitable for any kind
of service API. But most triggers will make use of periodic polling, and for
those simpler code is possible.

### Polling Trigger

    const Tp = require('thingpedia');

    module.exports = new Tp.ChannelClass({
        Name: 'MyPollingTrigger',
        Extends: Tp.PollingTrigger

        _init: function(engine, device, params) {
            this.parent();
            this.interval = 3600000; // in milliseconds
        },

        _onTick: function() {
            // do something
        },
    });

If you use `Tp.PollingTrigger` and you set the interval in the constructor
(or alternatively in the class definition, if it's a constant), then you
only need to override `_onTick`, which will be called periodically.

### HTTP Polling Trigger

An even more common case is that of a periodic HTTP poll. In that case, you can
use `Tp.HttpPollingTrigger`:

    const Tp = require('thingpedia');

    module.exports = new Tp.ChannelClass({
        Name: 'MyPollingTrigger',
        Extends: Tp.HttpPollingTrigger

        _init: function(engine, device, params) {
            this.parent();
            this.interval = 3600000;
            this.url = 'https://api.example.com/1.0/poll';
            this.auth = 'Bearer ' + device.accessToken;
        },

        _onResponse: function(data) {
            // do something
        },
    });

The `_onResponse` method of your channel class will be called with the
buffered HTTP response body, if the status is 200. 301 and 302
statuses are followed transparently, other statuses will log an error
and not call your method.

Use `this.auth` to set the content of the `Authorization` header (or
set it to `null` if you don't want one).

### HTTP Helpers

The HTTP polling trigger makes use of the more general `Tp.Helpers.Http`.
These are wrappers for nodejs [http API](https://nodejs.org/api/http.html)
with a Promise interface.

The available APIs are:

- `Http.get(url, options)`: Perform a buffered HTTP GET; `options` can contain `auth`
(`Authorization` header) and `accept` (`Accept` header); if `options.raw` is set,
returns a promise of the response body as a Buffer and the `Content-Type` header
as a String; otherwise, just a promise of the response body as a String
- `Http.post(url, data, options)`: Perform a buffer HTTP POST; `data` is a
Buffer or String; `options` is the same as `Http.get` plus `dataContentType`,
the `Content-Type` of the posted data
- `Http.getStream(url, options)`: Perform a streaming HTTP GET; returns a promise
of a [readable stream](https://nodejs.org/api/stream.html)
- `Http.postStream(url, data, options)`: Perform a streaming HTTP POST; `data` should
be a readable stream and will be piped.

## Device Metadata

In addition to a device package, each device specification published on
Thingpedia must include some metadata, called a _device manifest_, which will parsed
by Thingpedia to generate the web UI.

The manifest contains:

- The list of types the device claims to conform to
- The triggers and actions, their arguments, and the documentation for each
- The authentication method, and any parameter that needs to be configured manually by
  the user (such as IP address or username)

The manifest is written in JSON, and looks like this

    {
      "params": {
        "p1": ["P1 Label", "text"],
        "p2": ["P2 Label", "password"]
      },
      "types": ["t1", "t2"],
      "auth": {
        "type": "none"
      },
      "triggers": {
        "trigger1": {
            "args": ["astring", "anumber", "anothernumber"],
            "schema": ["String", "Number", "Number"],
            "doc": "produces a string and two numbers"
        }
      },
      "actions": {
        "action1": {
            "args": ["afeed","amessage"],
            "schema": ["Feed", "String"],
            "doc": "sends a message"
        }
      }
    }

The combination of `params` and `auth.type` determines the UI to configure
the device. Valid types for `auth.type` are:

- `"none"`, in which case the UI will show a form if there is any parameter,
or a button otherwise
- `"oauth2"`, in which case the UI will always show a button
- `"basic"`, in which case the UI will always show a form; `username` and `password`
  parameters are required

## Publishing on Thingpedia

Once you are ready to let other people try your device interface, after thorough
local testing, you can publish it on Thingpedia.

To do so, you must first
[request a developer account](https://thingengine.stanford.edu/user/request-developer).
Once the request is approved by the Thingpedia administrators (you can check the status
from [your profile page](https://thingengine.stanford.edu/user/profile)), you will be
able to upload a new device by clicking on
[Propose it for inclusion](https://thingengine.stanford.edu/thingpedia/upload/create?class=physical)
in the red banner in the Thingpedia page.

In the creation page you will be required to upload a zip file containing your
device package. The package.json must be at the toplevel of the zip file, not in a
subdirectory. You should always tick "This device requires additional JS code"
or your package will be ignored!

Each device package must contain all its dependencies, except for the `thingpedia`
module which is always provided. This also includes any promise library you might want
to use for channel classes.

Once submitted, the device is not automatically available to all users. Instead,
it is only available to you and people to who you give your _developer key_,
which you can retrieve from your user profile. The device will become available
after being reviewed and approved by a Thingpedia administrator.

## Handling Discovery

Local discovery in Thingpedia relies on the
[thingpedia-discovery](https://github.com/Stanford-IoT-Lab/thingpedia-discovery)
nodejs module, which contains the generic code to run the discovery protocols and
to match the discovery information to a specific interface.

If your interface supports discovery, your must implement the
`UseDiscovery(publicData, privateData)` device class method. `publicData` and
`privateData` are objects that contain information derived from the discovery
protocol, and are discovery protocol specific; `privateData` contains user
identifying information (such as serial numbers and HW addresses), while `publicData`
contains the generic capabilities inferred by discovery and is sent to Thingpedia
to match the interface. `publicData.kind` is the identifier for the discovery
protocol in use.

Furthermore, your device should implement `updateFromDiscovery(publicData, privateData)`,
which is called when a device that was already configured is rediscovered. You
can use this method to update any cached data about the device based on the
new advertisement, for example to update the Bluetooth alias.

Finally, your device should set `this.descriptors` to a list of protocol specific
device descriptors that will help the generic code recognize if a device was
already configured or not, and should set `state.discoveredBy` to `engine.ownTier`.

### Bluetooth discovery

Discovery data:

- `publicData.kind`: `bluetooth`
- `publicData.uuids`: array of lower case Bluetooth UUIDs
- `publicData.class`: the numeric Bluetooth class
- `privateData.address`: lower case canonical Bluetooth HW address
- `privateData.alias`: Bluetooth alias (human readable name)
- `privateData.paired`: if Bluetooth pairing happened already
- `privateData.trusted`: if the device is trusted to access services on the host
- `descriptor`: `bluetooth/` followed by the HW address

Thingpedia matching of interfaces is based on UUIDs.
If your interface wants to be a candidate for any device with a given UUID, it
should expose the type `bluetooth-uuid-`_uuid_, e.g. an interface implementing
the A2DP sink profile  would mark itself
with type `blueooth-uuid-000110b-0000-1000-8000-00805f9b34fb`.

The bluetooth class is used as a fallback, and an interface can expose the types
`bluetooth-class-health` for Bluetooth class `0x900`, `bluetooth-class-audio-video`
for Bluetooth class `0x400` and `bluetooth-class-phone` for Bluetooth class `0x200`.
Other Bluetooth classes are ignored.
