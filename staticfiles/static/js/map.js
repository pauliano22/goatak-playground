var map = null;

const OPERATIONAL_MODES = {
    firefighter: {
        name: "Firefighter",
        color: "#dc3545",
        tools: [
            { id: "fire", label: "Fire", color: "warning", icon: "fire" },
            { id: "wildfire", label: "Wildfire", color: "danger", icon: "exclamation-triangle" },
            { id: "water", label: "Water Source", color: "primary", icon: "droplet" },
            { id: "helipad", label: "Helipad", color: "info", icon: "circle-h" },
            { id: "staging", label: "Staging", color: "secondary", icon: "tent" },
            { id: "hazard", label: "Hazard", color: "danger", icon: "exclamation-diamond" }
        ]
    },
    recon: {
        name: "Recon",
        color: "#007bff",
        tools: [
            { id: "dp1", label: "Recon Point", color: "primary", icon: "map-marker-alt" },
            { id: "redx", label: "Red X", color: "danger", icon: "times-circle" }
        ]
    },
    command: {
        name: "Command",
        color: "#28a745",
        tools: [
            { id: "unit", label: "Unit", color: "success", icon: "users" },
            { id: "message", label: "Message", color: "info", icon: "comment-dots" }
        ]
    },
    // Add other operational modes here...
};

const app = Vue.createApp({
    data: function () {
        return {
            layers: null,
            conn: null,
            status: "",
            unitsMap: Vue.shallowRef(new Map()),
            messages: [],
            seenMessages: new Set(),
            ts: 0,
            locked_unit_uid: '',
            current_unit_uid: null,
            config: null,
            tools: new Map(),
            me: null,
            coords: null,
            point_num: 1,
            coord_format: "d",
            form_unit: {},
            types: null,
            chatroom: "",
            chat_uid: "",
            chat_msg: "",
            multiSelectMode: false,
            selectedUnits: new Set(),
            operationalMode: 'firefighter',
            OPERATIONAL_MODES: OPERATIONAL_MODES, // Add this line to make it available in template
        }
    },

    mounted() {
        map = L.map('map');
        map.setView([60, 30], 11);

        L.control.scale({ metric: true }).addTo(map);

        this.getConfig();

        let supportsWebSockets = 'WebSocket' in window || 'MozWebSocket' in window;

        if (supportsWebSockets) {
            this.connect();
        }

        this.renew();
        setInterval(this.renew, 5000);
        setInterval(this.sender, 1000);

        map.on('click', this.mapClick);
        map.on('mousemove', this.mouseMove);

        this.formFromUnit(null);

        // Add mode loading
        const savedMode = localStorage.getItem('goatak-mode') || 'firefighter';
        this.switchOperationalMode(savedMode);
    },

    computed: {
        current_unit: function () {
            return this.current_unit_uid ? this.current_unit_uid && this.getCurrentUnit() : null;
        },
        units: function () {
            return this.unitsMap?.value || new Map();
        },
        // Add computed properties for operational mode
        currentModeName: function() {
            return OPERATIONAL_MODES[this.operationalMode]?.name || 'Default';
        },
        currentModeColor: function() {
            return OPERATIONAL_MODES[this.operationalMode]?.color || '#6c757d';
        },
        chunkedTools: function() {
            const tools = OPERATIONAL_MODES[this.operationalMode]?.tools || [];
            const chunks = [];
            for (let i = 0; i < tools.length; i += 2) {
                chunks.push(tools.slice(i, i + 2));
            }
            return chunks;
        },
        modeIcon: function() {
            const mode = this.operationalMode;
            if (mode === 'firefighter') return 'fire';
            if (mode === 'police') return 'shield';
            if (mode === 'ems') return 'hospital';
            if (mode === 'sar') return 'compass';
            if (mode === 'recon') return 'binoculars';
            if (mode === 'command') return 'flag';
            return 'gear';
        }
    },

    methods: {
        getConfig: function () {
            let vm = this;

            fetch('/api/config')
                .then(resp => resp.json())
                .then(data => {
                    vm.config = data;

                    map.setView([data.lat, data.lon], data.zoom);

                    if (vm.config.callsign) {
                        vm.me = L.marker([data.lat, data.lon]);
                        vm.me.setIcon(L.icon({
                            iconUrl: "/static/icons/self.png",
                            iconAnchor: new L.Point(16, 16),
                        }));
                        vm.me.addTo(map);

                        fetch('/api/types')
                            .then(resp => resp.json())
                            .then(d => vm.types = d);
                    }

                    layers = L.control.layers({}, null, { hideSingleBase: true });
                    layers.addTo(map);

                    let first = true;
                    data.layers.forEach(function (i) {
                        let opts = {
                            minZoom: i.minZoom ?? 1,
                            maxZoom: i.maxZoom ?? 20,
                        }

                        if (i.parts) {
                            opts["subdomains"] = i.parts;
                        }

                        l = L.tileLayer(i.url, opts);

                        layers.addBaseLayer(l, i.name);

                        if (first) {
                            first = false;
                            l.addTo(map);
                        }
                    });
                });
        },

        connect: function () {
            let url = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
            let vm = this;

            this.fetchAllUnits();
            this.fetchMessages();

            this.conn = new WebSocket(url);

            this.conn.onmessage = function (e) {
                vm.processWS(JSON.parse(e.data));
            };

            this.conn.onopen = function (e) {
                console.log("connected");
                vm.status = "connected";
            };

            this.conn.onerror = function (e) {
                console.log("error");
                vm.status = "error";
            };

            this.conn.onclose = function (e) {
                console.log("closed");
                vm.status = "";
                setTimeout(vm.connect, 3000);
            };
        },

        fetchAllUnits: function () {
            let vm = this;

            fetch('/api/unit', { redirect: 'manual' })
                .then(resp => {
                    if (!resp.ok) {
                        window.location.reload();
                    }
                    return resp.json();
                })
                .then(vm.processUnits);
        },

        fetchMessages: function () {
            let vm = this;

            fetch('/api/message', { redirect: 'manual' })
                .then(resp => {
                    if (!resp.ok) {
                        window.location.reload();
                    }
                    return resp.json();
                })
                .then(d => vm.messages = d);
        },

        renew: function () {
            if (!this.conn) {
                this.fetchAllUnits();
                this.fetchMessages();
            }
        },

        sender: function () {
            if (this.getTool("dp1")) {
                let p = this.getTool("dp1").getLatLng();

                const requestOptions = {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ lat: p.lat, lon: p.lng, name: "DP1" })
                };
                fetch("/api/dp", requestOptions);
            }
        },

        processUnits: function (data) {
            let keys = new Set();

            for (let u of data) {
                keys.add(this.processUnit(u)?.uid);
            }

            for (const k of this.units.keys()) {
                if (!keys.has(k)) {
                    this.removeUnit(k);
                }
            }
        },

        processUnit: function (u) {
            if (!u) return;
            let unit = this.units.get(u.uid);

            if (!unit) {
                unit = new Unit(this, u);
                this.units.set(u.uid, unit);
            } else {
                unit.update(u)
            }

            if (this.locked_unit_uid === unit.uid) {
                map.setView(unit.coords());
            }

            this.ts++;

            return unit;
        },

        processWS: function (u) {
            if (u.type === "unit") {
                this.processUnit(u.unit);
            }

            if (u.type === "delete") {
                this.removeUnit(u.uid);
            }

            if (u.type === "chat") {
                this.fetchMessages();
            }
        },

        removeUnit: function (uid) {
            if (!this.units.has(uid)) return;

            let item = this.units.get(uid);
            item.removeMarker()
            this.units.delete(uid);

            if (this.current_unit_uid === uid) {
                this.setCurrentUnitUid(null, false);
            }
        },

        setCurrentUnitUid: function (uid, follow) {
            if (uid && this.units.has(uid)) {
                this.current_unit_uid = uid;
                let u = this.units.get(uid);
                if (follow) this.mapToUnit(u);
                this.formFromUnit(u);
            } else {
                this.current_unit_uid = null;
                this.formFromUnit(null);
            }
        },

        getCurrentUnit: function () {
            if (!this.current_unit_uid || !this.units.has(this.current_unit_uid)) return null;
            return this.units.get(this.current_unit_uid);
        },

        byCategory: function (s) {
            let arr = Array.from(this.units.values()).filter(function (u) {
                return u.unit.category === s
            });
            arr.sort(function (a, b) {
                return a.compare(b);
            });
            return this.ts && arr;
        },

        mapToUnit: function (u) {
            if (u && u.hasCoords()) {
                map.setView(u.coords());
            }
        },

        getImg: function (item, size) {
            return getIconUri(item, size, false).uri;
        },

        milImg: function (item) {
            return getMilIconUri(item, 24, false).uri;
        },

        dt: function (str) {
            let d = new Date(Date.parse(str));
            return ("0" + d.getDate()).slice(-2) + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
                d.getFullYear() + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
        },

        sp: function (v) {
            return (v * 3.6).toFixed(1);
        },

        // Update modeIs method to be more defensive
        modeIs: function (s) {
            const element = document.getElementById(s);
            return element ? element.checked : false;
        },

        mouseMove: function (e) {
            this.coords = e.latlng;
        },

        mapClick: function (e) {
            const activeTool = OPERATIONAL_MODES[this.operationalMode]?.tools.find(
                tool => this.modeIs(tool.id)
            );

            if (activeTool) {
                // Handle mode-specific tools
                switch(activeTool.id) {
                    case "redx":
                        this.addOrMove("redx", e.latlng, "/static/icons/x.png");
                        return;
                    case "dp1":
                        this.addOrMove("dp1", e.latlng, "/static/icons/spoi_icon.png");
                        return;
                    // Add other tool handlers as needed
                }
            }

            // Continue with existing handlers
            if (this.modeIs("checkpoint")) {
                let uid = uuidv4();
                let now = new Date();
                let stale = new Date(now);
                stale.setDate(stale.getDate() + 365);

                let u = {
                    uid: uid,
                    category: "point",
                    callsign: "CP-" + this.point_num++,
                    sidc: "",
                    start_time: now,
                    last_seen: now,
                    stale_time: stale,
                    type: "b-m-p-c",  // CoT type for checkpoint
                    lat: e.latlng.lat,
                    lon: e.latlng.lng,
                    hae: 0,
                    speed: 0,
                    course: 0,
                    status: "",
                    text: "Checkpoint",
                    parent_uid: "",
                    parent_callsign: "",
                    color: "#00ff00",  // Green color
                    send: false,
                    local: true,
                }

                if (this.config && this.config.uid) {
                    u.parent_uid = this.config.uid;
                    u.parent_callsign = this.config.callsign;
                }

                let unit = new Unit(this, u);
                this.units.set(unit.uid, unit);
                unit.post();

                this.setCurrentUnitUid(u.uid, true);
                return;
            }

            // Fire point handler
            if (this.modeIs("fire")) {
                let uid = uuidv4();
                let now = new Date();
                let stale = new Date(now);
                stale.setDate(stale.getDate() + 365);

                let u = {
                    uid: uid,
                    category: "point",
                    callsign: "Fire-" + this.point_num++,
                    sidc: "",
                    start_time: now,
                    last_seen: now,
                    stale_time: stale,
                    type: "b-r-f-h-c",  // CoT type for fire/hazard
                    lat: e.latlng.lat,
                    lon: e.latlng.lng,
                    hae: 0,
                    speed: 0,
                    course: 0,
                    status: "",
                    text: "Fire Location",
                    parent_uid: "",
                    parent_callsign: "",
                    color: "#ff8c00",  // Orange color
                    send: false,
                    local: true,
                }

                if (this.config && this.config.uid) {
                    u.parent_uid = this.config.uid;
                    u.parent_callsign = this.config.callsign;
                }

                let unit = new Unit(this, u);
                this.units.set(unit.uid, unit);
                unit.post();

                this.setCurrentUnitUid(u.uid, true);
                return;
            }

            // Wildfire point handler
            if (this.modeIs("wildfire")) {
                let uid = uuidv4();
                let now = new Date();
                let stale = new Date(now);
                stale.setDate(stale.getDate() + 365);

                let u = {
                    uid: uid,
                    category: "point",
                    callsign: "Wildfire-" + this.point_num++,
                    sidc: "",
                    start_time: now,
                    last_seen: now,
                    stale_time: stale,
                    type: "b-r-f-h-c",  // CoT type for fire/hazard
                    lat: e.latlng.lat,
                    lon: e.latlng.lng,
                    hae: 0,
                    speed: 0,
                    course: 0,
                    status: "",
                    text: "Wildfire - Active",
                    parent_uid: "",
                    parent_callsign: "",
                    color: "#ff0000",  // Red color
                    send: false,
                    local: true,
                }

                if (this.config && this.config.uid) {
                    u.parent_uid = this.config.uid;
                    u.parent_callsign = this.config.callsign;
                }

                let unit = new Unit(this, u);
                this.units.set(unit.uid, unit);
                unit.post();

                this.setCurrentUnitUid(u.uid, true);
                return;
            }

            if (this.modeIs("point")) {
                let uid = uuidv4();
                let now = new Date();
                let stale = new Date(now);
                stale.setDate(stale.getDate() + 365);
                let u = {
                    uid: uid,
                    category: "point",
                    callsign: "point-" + this.point_num++,
                    sidc: "",
                    start_time: now,
                    last_seen: now,
                    stale_time: stale,
                    type: "b-m-p-s-m",
                    lat: e.latlng.lat,
                    lon: e.latlng.lng,
                    hae: 0,
                    speed: 0,
                    course: 0,
                    status: "",
                    text: "",
                    parent_uid: "",
                    parent_callsign: "",
                    color: "#ff0000",
                    send: false,
                    local: true,
                }
                if (this.config && this.config.uid) {
                    u.parent_uid = this.config.uid;
                    u.parent_callsign = this.config.callsign;
                }

                let unit = new Unit(this, u);
                this.units.set(unit.uid, unit);
                unit.post();

                this.setCurrentUnitUid(u.uid, true);
            }
            if (this.modeIs("me")) {
                this.config.lat = e.latlng.lat;
                this.config.lon = e.latlng.lng;
                this.me.setLatLng(e.latlng);
                const requestOptions = {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ lat: e.latlng.lat, lon: e.latlng.lng })
                };
                fetch("/api/pos", requestOptions);
            }
        },

        formFromUnit: function (u) {
            if (!u) {
                this.form_unit = {
                    callsign: "",
                    category: "",
                    type: "",
                    subtype: "",
                    aff: "",
                    text: "",
                    send: false,
                    root_sidc: null,
                };
            } else {
                this.form_unit = {
                    callsign: u.unit.callsign,
                    category: u.unit.category,
                    type: u.unit.type,
                    subtype: "G",
                    aff: "h",
                    text: u.unit.text,
                    send: u.unit.send,
                    root_sidc: this.types,
                };

                if (u.unit.type.startsWith('a-')) {
                    this.form_unit.type = 'b-m-p-s-m';
                    this.form_unit.aff = u.unit.type.substring(2, 3);
                    this.form_unit.subtype = u.unit.type.substring(4);
                    this.form_unit.root_sidc = this.getRootSidc(u.unit.type.substring(4))
                }
            }
        },

        saveEditForm: function () {
            let u = this.getCurrentUnit();
            if (!u) return;

            u.unit.callsign = this.form_unit.callsign;
            u.unit.category = this.form_unit.category;
            u.unit.send = this.form_unit.send;
            u.unit.text = this.form_unit.text;

            if (this.form_unit.category === "unit") {
                u.unit.type = ["a", this.form_unit.aff, this.form_unit.subtype].join('-');
                u.unit.sidc = this.sidcFromType(u.unit.type);
            } else {
                u.unit.type = this.form_unit.type;
                u.unit.sidc = "";
            }

            u.redraw = true;
            u.updateMarker();
            u.post();
        },

        getRootSidc: function (s) {
            let curr = this.types;

            for (; ;) {
                if (!curr?.next) {
                    return null;
                }

                let found = false;
                for (const k of curr.next) {
                    if (k.code === s) {
                        return curr;
                    }

                    if (s.startsWith(k.code)) {
                        curr = k;
                        found = true;
                        break
                    }
                }
                if (!found) {
                    return null;
                }
            }
        },

        getSidc: function (s) {
            let curr = this.types;

            if (s === "") {
                return curr;
            }

            for (; ;) {
                if (!curr?.next) {
                    return null;
                }

                for (const k of curr.next) {
                    if (k.code === s) {
                        return k;
                    }

                    if (s.startsWith(k.code)) {
                        curr = k;
                        break
                    }
                }
            }
        },

        setFormRootSidc: function (s) {
            let t = this.getSidc(s);
            if (t?.next) {
                this.form_unit.root_sidc = t;
                this.form_unit.subtype = t.next[0].code;
            } else {
                this.form_unit.root_sidc = this.types;
                this.form_unit.subtype = this.types.next[0].code;
            }
        },

        removeTool: function (name) {
            if (this.tools.has(name)) {
                let p = this.tools.get(name);
                map.removeLayer(p);
                p.remove();
                this.tools.delete(name);
                this.ts++;
            }
        },

        getTool: function (name) {
            return this.tools.get(name);
        },

        addOrMove(name, coord, icon) {
            if (this.tools.has(name)) {
                this.tools.get(name).setLatLng(coord);
            } else {
                let p = new L.marker(coord).addTo(map);
                if (icon) {
                    p.setIcon(L.icon({
                        iconUrl: icon,
                        iconSize: [20, 20],
                        iconAnchor: new L.Point(10, 10),
                    }));
                }
                this.tools.set(name, p);
            }
            this.ts++;
        },

        printCoordsll: function (latlng) {
            return this.printCoords(latlng.lat, latlng.lng);
        },

        printCoords: function (lat, lng) {
            return lat.toFixed(6) + "," + lng.toFixed(6);
        },

        latlng: function (lat, lon) {
            return L.latLng(lat, lon);
        },

        distBea: function (p1, p2) {
            let toRadian = Math.PI / 180;
            // haversine formula
            // bearing
            let y = Math.sin((p2.lng - p1.lng) * toRadian) * Math.cos(p2.lat * toRadian);
            let x = Math.cos(p1.lat * toRadian) * Math.sin(p2.lat * toRadian) - Math.sin(p1.lat * toRadian) * Math.cos(p2.lat * toRadian) * Math.cos((p2.lng - p1.lng) * toRadian);
            let brng = Math.atan2(y, x) * 180 / Math.PI;
            brng += brng < 0 ? 360 : 0;
            // distance
            let R = 6371000; // meters
            let deltaF = (p2.lat - p1.lat) * toRadian;
            let deltaL = (p2.lng - p1.lng) * toRadian;
            let a = Math.sin(deltaF / 2) * Math.sin(deltaF / 2) + Math.cos(p1.lat * toRadian) * Math.cos(p2.lat * toRadian) * Math.sin(deltaL / 2) * Math.sin(deltaL / 2);
            let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            let distance = R * c;
            return (distance < 10000 ? distance.toFixed(0) + "m " : (distance / 1000).toFixed(1) + "km ") + brng.toFixed(1) + "°T";
        },

        contactsNum: function () {
            let online = 0;
            let total = 0;
            this.units.forEach(function (u) {
                if (u.isContact()) {
                    if (u.isOnline()) online += 1;
                    total += 1;
                }
            })

            return online + "/" + total;
        },

        countByCategory: function (s) {
            let total = 0;
            this.units.forEach(function (u) {
                if (u.unit.category === s) total += 1;
            })

            return total;
        },

        msgNum: function (all) {
            if (!this.messages) return 0;
            let n = 0;
            for (const [key, value] of Object.entries(this.messages)) {
                if (value.messages) {
                    for (m of value.messages) {
                        if (all || !this.seenMessages.has(m.message_id)) n++;
                    }
                }
            }
            return n;
        },

        msgNum1: function (uid, all) {
            if (!this.messages || !this.messages[uid].messages) return 0;
            let n = 0;
            for (m of this.messages[uid].messages) {
                if (all || !this.seenMessages.has(m.message_id)) n++;
            }
            return n;
        },

        openChat: function (uid, chatroom) {
            this.chat_uid = uid;
            this.chatroom = chatroom;
            new bootstrap.Modal(document.getElementById('messages')).show();

            if (this.messages[this.chat_uid]) {
                for (m of this.messages[this.chat_uid].messages) {
                    this.seenMessages.add(m.message_id);
                }
            }
        },

        getStatus: function (uid) {
            return this.ts && this.units.get(uid)?.unit?.status;
        },

        getMessages: function () {
            if (!this.chat_uid) {
                return [];
            }

            let msgs = this.messages[this.chat_uid] ? this.messages[this.chat_uid].messages : [];

            if (document.getElementById('messages').style.display !== 'none') {
                for (m of msgs) {
                    this.seenMessages.add(m.message_id);
                }
            }

            return msgs;
        },

        cancelEditForm: function () {
            this.formFromUnit(this.getCurrentUnit());
        },

        sidcFromType: function (s) {
            if (!s || !s.startsWith('a-')) return "";

            let n = s.split('-');

            let sidc = 'S' + n[1];

            if (n.length > 2) {
                sidc += n[2] + 'P';
            } else {
                sidc += '-P';
            }

            if (n.length > 3) {
                for (let i = 3; i < n.length; i++) {
                    if (n[i].length > 1) {
                        break
                    }
                    sidc += n[i];
                }
            }

            if (sidc.length < 10) {
                sidc += '-'.repeat(10 - sidc.length);
            }

            return sidc.toUpperCase();
        },

        deleteCurrentUnit: function () {
            if (!this.current_unit_uid) return;
            fetch("/api/unit/" + this.current_unit_uid, { method: "DELETE" });
        },

        sendMessage: function () {
            let msg = {
                from: this.config.callsign,
                from_uid: this.config.uid,
                chatroom: this.chatroom,
                to_uid: this.chat_uid,
                text: this.chat_msg,
            };
            this.chat_msg = "";

            const requestOptions = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(msg)
            };
            let vm = this;
            fetch("/api/message", requestOptions)
                .then(resp => resp.json())
                .then(d => vm.messages = d);

        },

        // Toggle multi-select mode
        toggleMultiSelect: function() {
            this.multiSelectMode = !this.multiSelectMode;
            if (!this.multiSelectMode) {
                // Clear selections when exiting multi-select
                this.selectedUnits.clear();
                this.redrawAllMarkers();
            }
        },
        
        toggleUnitSelection: function(uid) {
            if (this.selectedUnits.has(uid)) {
                this.selectedUnits.delete(uid);
            } else {
                this.selectedUnits.add(uid);
            }
            // Update visual indicator
            let unit = this.units.get(uid);
            if (unit) {
                unit.updateMarker();
            }
        },
        
        deleteSelectedUnits: function() {
            if (this.selectedUnits.size === 0) return;
            
            if (confirm(`Delete ${this.selectedUnits.size} selected items?`)) {
                let deletePromises = [];
                this.selectedUnits.forEach(uid => {
                    deletePromises.push(
                        fetch("/api/unit/" + uid, { method: "DELETE" })
                    );
                });
                
                Promise.all(deletePromises).then(() => {
                    this.selectedUnits.clear();
                    this.multiSelectMode = false;
                    this.fetchAllUnits();
                });
            }
        },
        
        redrawAllMarkers: function() {
            this.units.forEach(unit => {
                unit.updateMarker();
            });
        },

        switchOperationalMode: function(mode) {
            if (OPERATIONAL_MODES[mode]) {
                this.operationalMode = mode;
                this.updateTheme(mode);
                localStorage.setItem('goatak-mode', mode);
            } else {
                console.warn(`Invalid operational mode: ${mode}`);
                this.operationalMode = 'firefighter'; // Fallback to default
            }
        },

        updateTheme: function(mode) {
            const config = OPERATIONAL_MODES[mode] || OPERATIONAL_MODES.firefighter;
            document.documentElement.style.setProperty('--mode-primary', config.color);
            document.querySelector('.navbar').style.background = 
                `linear-gradient(135deg, ${config.color} 0%, ${this.darkenColor(config.color, 20)} 100%)`;
        },

        darkenColor: function(color, percent) {
            const num = parseInt(color.replace("#", ""), 16);
            const amt = Math.round(2.55 * percent);
            const R = (num >> 16) - amt;
            const G = (num >> 8 & 0x00FF) - amt;
            const B = (num & 0x0000FF) - amt;
            return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
                (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
                (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
        },

        clearAllLocalPoints: function() {
            if (confirm('Are you sure you want to clear all local points?')) {
                const localUnits = Array.from(this.units.values())
                    .filter(u => u.unit.local)
                    .map(u => u.uid);
                    
                let deletePromises = localUnits.map(uid => 
                    fetch("/api/unit/" + uid, { method: "DELETE" })
                );
                
                Promise.all(deletePromises).then(() => {
                    this.fetchAllUnits();
                });
            }
        },
    },
});

app.mount('#app');

class Unit {
    constructor(app, u) {
        this.app = app;
        this.unit = u;
        this.uid = u.uid;
        this.updateMarker();
    }

    update(u) {
        if (this.unit.uid !== u.uid) {
            throw "wrong uid";
        }

        this.redraw = this.needsRedraw(u);

        for (const k of Object.keys(u)) {
            this.unit[k] = u[k];
        }

        this.updateMarker();

        return this;
    }

    needsRedraw(u) {
        if (this.unit.type !== u.type || this.unit.sidc !== u.sidc || this.unit.status !== u.status) return true;
        if (this.unit.speed !== u.speed || this.unit.direction !== u.direction) return true;
        if (this.unit.team !== u.team || this.unit.role !== u.role) return true;

        if (this.unit.sidc.charAt(2) === 'A' && this.unit.hae !== u.hae) return true;
        return false;
    }

    isContact() {
        return this.unit.category === "contact"
    }

    isOnline() {
        return this.unit.status === "Online";
    }

    name() {
        let res = this.unit?.callsign || "no name";
        if (this.unit.parent_uid === this.app.config?.uid) {
            if (this.unit.send) {
                res = "+ " + res;
            } else {
                res = "* " + res;
            }
        }
        return res;
    }

    removeMarker() {
        if (this.marker) {
            map.removeLayer(this.marker);
            this.marker.remove();
            this.marker = null;
        }
    }

    updateMarker() {
        if (!this.hasCoords()) {
            this.removeMarker();
            return;
        }

        if (this.marker) {
            if (this.redraw) {
                this.marker.setIcon(getIcon(this.unit, true));
            }
            // Add visual indicator for selected state
            this.marker.setOpacity(this.app.selectedUnits.has(this.uid) ? 0.5 : 1.0);
        } else {
            this.marker = L.marker(this.coords(), { draggable: this.unit.local ? 'true' : 'false' });
            this.marker.setIcon(getIcon(this.unit, true));

            let vm = this;
            if (this.unit.local) {
                this.marker.on('dragend', function (e) {
                    vm.unit.lat = e.target.getLatLng().lat;
                    vm.unit.lon = e.target.getLatLng().lng;
                });
            }

            this.marker.addTo(map);
        }

        this.marker.setLatLng(this.coords());
        this.marker.bindTooltip(this.popup());
        this.redraw = false;

        // Update click handler for multi-select support
        let vm = this;
        this.marker.on('click', function (e) {
            if (vm.app.multiSelectMode) {
                vm.app.toggleUnitSelection(vm.uid);
            } else {
                vm.app.setCurrentUnitUid(vm.uid, false);
            }
        });
    }

    hasCoords() {
        return this.unit.lat && this.unit.lon;
    }

    coords() {
        return [this.unit.lat, this.unit.lon];
    }

    latlng() {
        return L.latLng(this.unit.lat, this.unit.lon)
    }

    compare(u2) {
        return this.unit.callsign.toLowerCase().localeCompare(u2.unit.callsign.toLowerCase());
    }

    popup() {
        let v = '<b>' + this.unit.callsign + '</b><br/>';
        if (this.unit.team) v += this.unit.team + ' ' + this.unit.role + '<br/>';
        if (this.unit.speed) v += 'Speed: ' + this.unit.speed.toFixed(0) + ' m/s<br/>';
        if (this.unit.sidc.charAt(2) === 'A') {
            v += "hae: " + this.unit.hae.toFixed(0) + " m<br/>";
        }
        v += this.unit.text.replaceAll('\n', '<br/>').replaceAll('; ', '<br/>');
        return v;
    }

    post() {
        const requestOptions = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(this.unit)
        };
        let vm = this;
        fetch("/api/unit", requestOptions)
            .then(resp => resp.json())
            .then(d => vm.app.processUnit(d));
    }
}
