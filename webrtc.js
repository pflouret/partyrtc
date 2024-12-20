(function () {
    var PHONE = window.PHONE = function (config) {
        config.ssl = true; // Force HTTPS
        var PHONE = function () { };
        var pubnub = PUBNUB(config);
        var pubkey = config.publish_key || 'demo';
        var subkey = config.subscribe_key || 'demo';
        var sessionid = PUBNUB.uuid();
        var mystream = null;
        var myvideo = document.createElement('video');
        var myconnection = false;
        var mediaconf = config.media || { audio: false, video: true };
        var conversations = {};

        var PeerConnection = window.RTCPeerConnection;
        var IceCandidate = window.RTCIceCandidate;
        var SessionDescription = window.RTCSessionDescription;

        var rtcconfig = {
            iceServers: [
                { "url": navigator.mediaDevices.getUserMedia ? "stun:stun.l.google.com:19302" : "stun:23.21.150.121" },
                { url: "stun:stun.l.google.com:19302" },
                { url: "stun:stun1.l.google.com:19302" },
                { url: "stun:stun2.l.google.com:19302" },
                { url: "stun:stun3.l.google.com:19302" },
                { url: "stun:stun4.l.google.com:19302" },
                { url: "stun:23.21.150.121" },
                { url: "stun:stun01.sipphone.com" },
                { url: "stun:stun.ekiga.net" },
                { url: "stun:stun.fwdnet.net" },
                { url: "stun:stun.ideasip.com" },
                { url: "stun:stun.iptel.org" },
                { url: "stun:stun.rixtelecom.se" },
                { url: "stun:stun.schlund.de" },
                { url: "stun:stunserver.org" },
                { url: "stun:stun.softjoys.com" },
                { url: "stun:stun.voiparound.com" },
                { url: "stun:stun.voipbuster.com" },
                { url: "stun:stun.voipstunt.com" },
                { url: "stun:stun.voxgratia.org" },
                { url: "stun:stun.xten.com" }]
        };

        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // PHONE Events
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        var messagecb = () => { };
        var readycb = () => { };
        var unablecb = () => { };
        var debugcb = () => { };
        var connectcb = () => { };
        var disconnectcb = () => { };
        var reconnectcb = () => { };
        var callstatuscb = () => { };
        var receivercb = () => { };
        var datachannelcb = () => { };

        PHONE.message = (cb) => { messagecb = cb; };
        PHONE.ready = (cb) => { readycb = cb; };
        PHONE.unable = (cb) => { unablecb = cb; };
        PHONE.callstatus = (cb) => { callstatuscb = cb; };
        PHONE.debug = (cb) => { debugcb = cb; };
        PHONE.connect = (cb) => { connectcb = cb; };
        PHONE.disconnect = (cb) => { disconnectcb = cb; };
        PHONE.reconnect = (cb) => { reconnectcb = cb; };
        PHONE.receive = (cb) => { receivercb = cb; };
        PHONE.datachannel = (cb) => { datachannelcb = cb; };

        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // Add/Get Conversation - Creates a new PC or Returns Existing PC
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        function get_conversation(number, isAnswer) {
            var talk = conversations[number] || (function (number) {
                var talk = {
                    number: number,
                    status: '',
                    image: document.createElement('img'),
                    started: +new Date,
                    imgset: false,
                    imgsent: 0,
                    pc: new PeerConnection(rtcconfig),
                    closed: false,
                    usermsg: function () { },
                    thumb: null,
                    connect: function () { },
                    end: function () { }
                };

                // Setup Event Methods
                talk.pc.onaddstream = config.onaddstream || onaddstream;
                talk.pc.onicecandidate = onicecandidate;
                talk.pc.number = number;

                // Setup Data Channel
                if (config.datachannels) {
                    if (isAnswer) {
                        talk.pc.ondatachannel = function (event) {
                            talk.datachannel = event.channel;
                            setChannelEvents(talk.datachannel);
                        };
                    } else {
                        var dataChannelOptions = { ordered: true, maxRetransmits: 2 };
                        talk.datachannel = talk.pc.createDataChannel(number + "-dc", dataChannelOptions);
                        setChannelEvents(talk.datachannel);
                    }
                }

                // Disconnect and Hangup
                talk.hangup = function (signal) {
                    if (talk.closed) return;

                    talk.closed = true;
                    talk.imgset = false;
                    clearInterval(talk.snapi);

                    if (signal !== false) transmit(number, { hangup: true });

                    talk.end(talk);
                    talk.pc.close();
                    close_conversation(number);
                };

                // Sending Messages
                talk.send = function (message) {
                    transmit(number, { usermsg: message });
                };

                talk.sendData = function (message) {
                    if (!talk.datachannel) return console.log("Need to configure datachannel in settings.");
                    if (typeof (message) === 'object') return talk.datachannel.send(JSON.stringify(message));
                    talk.datachannel.send(message);
                };

                // Nice Accessor to Update Disconnect & Establis CBs
                talk.thumbnail = function (cb) { talk.thumb = cb; return talk; };
                talk.ended = function (cb) { talk.end = cb; return talk; };
                talk.connected = function (cb) { talk.connect = cb; return talk; };
                talk.message = function (cb) { talk.usermsg = cb; return talk; };

                talk.pc.addStream(mystream);

                // Notify of Call Status
                update_conversation(talk, 'connecting');

                // Return Brand New Talk Reference
                conversations[number] = talk;
                return talk;
            })(number);

            // Return Existing or New Reference to Caller
            return talk;
        }

        function close_conversation(number) {
            conversations[number] = null;
            delete conversations[number];
        }

        function update_conversation(talk, status) {
            talk.status = status;
            callstatuscb(talk);
            return talk;
        }

        PHONE.number = function () {
            return config.number;
        };

        PHONE.dial = function (number, servers) {
            var talk = get_conversation(number);
            var pc = talk.pc;

            // Prevent Repeat Calls
            if (talk.dialed) return false;
            talk.dialed = true;

            // Send SDP Offer (Call)
            pc.createOffer(function (offer) {
                transmit(number, { hangup: true });
                transmit(number, offer, 2);
                pc.setLocalDescription(offer, debugcb, debugcb);
            }, debugcb);

            // Return Session Reference
            return talk;
        };

        PHONE.send = function (message, number) {
            if (number) return get_conversation(number).send(message);
            PUBNUB.each(conversations, function (number, talk) {
                talk.send(message);
            });
        };

        PHONE.sendData = function (message, number) {
            if (number) return get_conversation(number).sendData(message);
            PUBNUB.each(conversations, function (number, talk) {
                talk.sendData(message);
            });
        };

        PHONE.hangup = function (number) {
            if (number) return get_conversation(number).hangup();
            PUBNUB.each(conversations, function (number, talk) {
                talk.hangup();
            });
        };

        PHONE.mystream = mystream;
        PHONE.pubnub = pubnub;

        PUBNUB.bind('unload,beforeunload', window, function () {
            if (PHONE.goodbye) return true;
            PHONE.goodbye = true;

            PUBNUB.each(conversations, function (number, talk) {
                var mynumber = config.number;
                var packet = { hangup: true };
                var message = { packet: packet, id: sessionid, number: mynumber };
                var client = new XMLHttpRequest();
                var url = 'http://pubsub.pubnub.com/publish/'
                    + pubkey + '/'
                    + subkey + '/0/'
                    + number + '/0/'
                    + JSON.stringify(message);

                client.open('GET', url, false);
                client.send();
                talk.hangup();
            });

            return true;
        });

        function snapshots_setup(stream) {
            var video = myvideo;

            video.srcObject = stream;
            video.width = "640px";
            video.height = "480px";
            video.volume = 0.0;
            video.playsInline = true;
            video.muted = true;
            video.play();

            PHONE.video = video;
        }

        function onaddstream(obj) {
            var vid = document.createElement('video');
            var stream = obj.stream;
            var number = (obj.srcElement || obj.target).number;
            var talk = get_conversation(number);

            vid.setAttribute('autoplay', 'autoplay');
            vid.setAttribute('controls', 'controls');
            vid.setAttribute('data-number', number);
            vid.srcObject = stream;

            talk.video = vid;
            talk.connect(talk);
        }

        function setChannelEvents(datachannel) {
            datachannel.onmessage = function (m) {
                try {
                    var msg = JSON.parse(m.data);
                    datachannelcb(msg);
                } catch (e) {
                    datachannelcb(m.data);
                }
            };
            datachannel.onopen = function () { debugcb("------ DATACHANNEL OPENED ------"); };
            datachannel.onclose = function () { debugcb("------ DATACHANNEL CLOSED ------"); };
            datachannel.onerror = function () { debugcb("------ DATACHANNEL ERROR! ------"); };
        }
        function ondatachannel(e) { console.log("Pass ondataconfig function in phone configurations object."); }

        function onicecandidate(event) {
            if (!event.candidate) return;
            transmit(this.number, event.candidate);
        };

        function subscribe() {
            console.log("Subscribed to " + config.number);
            pubnub.subscribe({
                restore: true,
                channel: config.number,
                message: receive,
                disconnect: disconnectcb,
                reconnect: reconnectcb,
                connect: function () { onready(true); }
            });
        }

        function onready(subscribed) {
            if (subscribed) myconnection = true;
            if (!(mystream && myconnection)) return;

            connectcb();
            readycb();
        }

        function getusermedia() {
            const handle = function (stream) {
                if (!stream) return unablecb(stream);
                mystream = stream;
                phone.mystream = stream;
                snapshots_setup(stream);
                onready();
                subscribe();
            };
            const err = function (info) {
                debugcb(info);
                return unablecb(info);
            };
            if (navigator.getUserMedia) {
                navigator.getUserMedia(mediaconf, handle, err);
            } else {
                navigator.mediaDevices.getUserMedia(mediaconf, handle, err);
            }
        }

        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // Send SDP Call Offers/Answers and ICE Candidates to Peer
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        function transmit(phone, packet, times, time) {
            if (!packet) return;
            var number = config.number;
            var message = { packet: packet, id: sessionid, number: number };
            debugcb(message);
            pubnub.publish({ channel: phone, message: message });

            // Recurse if Requested for
            if (!times) return;
            time = time || 1;
            if (time++ >= times) return;
            setTimeout(function () {
                transmit(phone, packet, times, time);
            }, 150);
        }

        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // SDP Offers & ICE Candidates Receivable Processing
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        function receive(message) {
            // Debug Callback of Data to Watch
            debugcb(message);

            // Get Call Reference
            var talk = get_conversation(message.number, true);

            // Ignore if Closed
            if (talk.closed) return;

            // User Message
            if (message.packet.usermsg) {
                messagecb(talk, message.packet.usermsg);
                return talk.usermsg(talk, message.packet.usermsg);
            }

            // If Hangup Request
            if (message.packet.hangup) return talk.hangup(false);

            // If Peer Calling Inbound (Incoming) - Can determine stream + receive here.
            if (message.packet.sdp && !talk.received) {
                talk.received = true;
                receivercb(talk);
            }

            // Update Peer Connection with SDP Offer or ICE Routes
            if (message.packet.sdp) add_sdp_offer(message);
            else add_ice_route(message);
        }

        function add_sdp_offer(message) {
            // Get Call Reference
            var talk = get_conversation(message.number, message.packet.type == 'answer');
            var pc = talk.pc;
            var type = message.packet.type == 'offer' ? 'offer' : 'answer';

            // Deduplicate SDP Offerings/Answers
            if (type in talk) return;
            talk[type] = true;
            talk.dialed = true;

            // Notify of Call Status
            update_conversation(talk, 'routing');

            // Add SDP Offer/Answer
            pc.setRemoteDescription(
                new SessionDescription(message.packet), function () {
                    // Set Connected Status
                    update_conversation(talk, 'connected');

                    // Call Online and Ready
                    if (pc.remoteDescription.type != 'offer') return;

                    // Create Answer to Call
                    pc.createAnswer(function (answer) {
                        pc.setLocalDescription(answer, debugcb, debugcb);
                        transmit(message.number, answer, 2);
                    }, debugcb);
                }, debugcb
            );
        }

        function add_ice_route(message) {
            // Leave if Non-good ICE Packet
            if (!message.packet) return;
            if (!message.packet.candidate) return;

            // Get Call Reference
            var talk = get_conversation(message.number);
            var pc = talk.pc;

            // Add ICE Candidate Routes
            pc.addIceCandidate(
                new IceCandidate(message.packet),
                debugcb,
                debugcb
            );
        }

        getusermedia();

        return PHONE;
    };
})();
