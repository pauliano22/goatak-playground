const colors = new Map([
    ['Clear', 'white'],
    ['White', 'white'],
    ['Yellow', 'yellow'],
    ['Orange', 'orange'],
    ['Magenta', 'magenta'],
    ['Red', 'red'],
    ['Maroon', 'maroon'],
    ['Purple', 'purple'],
    ['Dark Blue', 'darkblue'],
    ['Blue', 'blue'],
    ['Cyan', 'cyan'],
    ['Teal', 'teal'],
    ['Green', 'green'],
    ['Dark Green', 'darkgreen'],
    ['Brown', 'brown'],
]);

const roles = new Map([
    ['HQ', 'HQ'],
    ['Team Lead', 'TL'],
    ['K9', 'K9'],
    ['Forward Observer', 'FO'],
    ['Sniper', 'S'],
    ['Medic', 'M'],
    ['RTO', 'R'],
]);

function getIconUri(item, size, withText) {
    if (item.team && item.role) {
        let col = "#555";
        if (item.status !== "Offline") {
            col = colors.get(item.team);
        }
        return {
            uri: toUri(circle(size, col, '#000', roles.get(item.role) ?? '')),
            x: Math.round(size / 2),
            y: Math.round(size / 2)
        };
    }
    if (item.icon && item.icon.startsWith("COT_MAPPING_SPOTMAP/")) {
        return {uri: toUri(circle(16, item.color || '#777', '#000', null)), x: 8, y: 8}
    }
    if (item.type === "b") {
        return {uri: "/static/icons/b.png", x: 16, y: 16}
    }
    if (item.type === "b-m-p-w-GOTO") {
        return {uri: "/static/icons/green_flag.png", x: 6, y: 30}
    }
    if (item.type === "b-m-p-s-p-op") {
        return {uri: "/static/icons/binos.png", x: 16, y: 16}
    }
    if (item.type === "b-m-p-s-p-loc") {
        return {uri: "/static/icons/sensor_location.png", x: 16, y: 16}
    }
    if (item.type === "b-m-p-s-p-i") {
        return {uri: "/static/icons/b-m-p-s-p-i.png", x: 16, y: 16}
    }
    if (item.type === "b-m-p-a") {
        return {uri: "/static/icons/aimpoint.png", x: 16, y: 16}
    }

    // Additional icon mapping
    if (item.type === "b-m-p-c") {
        return {uri: "/static/icons/checkpoint.png", x: 16, y: 16}
    }

    if (item.type === "b-r-f-h-c") {  // Fire/hazard type
        // You can differentiate by callsign or color
        if (item.color === "#ff0000" || item.callsign?.includes("Wildfire")) {
            // For wildfire - use a custom icon if you have one
            return {uri: "/static/icons/wildfire.png", x: 16, y: 16}
        } else {
            // For regular fire - use a custom icon or colored circle
            return {uri: "/static/icons/fire.png", x: 16, y: 16}
        }
    }

    // Mode-specific icons
    if (item.mode) {
        // Water source
        if (item.type === "b-r-f-w") {
            return {uri: toUri(circle(20, '#0000ff', '#000', 'W')), x: 10, y: 10}
        }
        // Helipad
        if (item.type === "b-r-f-h-h") {
            return {uri: toUri(circleWithH(20, '#00ff00')), x: 10, y: 10}
        }
        // Evidence
        if (item.type === "b-m-p-s-e") {
            return {uri: toUri(circle(20, '#ffff00', '#000', 'E')), x: 10, y: 10}
        }
        // Medical casualty
        if (item.type === "b-r-f-m-c") {
            return {uri: toUri(circleWithCross(20, '#ff0000')), x: 10, y: 10}
        }
    }

    if (item.category === "point") {
        return {uri: toUri(circle(16, item.color || '#f00', '#000', null)), x: 8, y: 8}
    }
    return getMilIconUri(item, size, withText);
}

function getMilIconUri(item, size, withText) {
    let opts = {size: size};

    if (!item.sidc) {
        return "";
    }

    if (withText) {
        // opts['uniqueDesignation'] = item.callsign;
        if (item.speed > 0) {
            opts['speed'] = (item.speed * 3.6).toFixed(1) + " km/h";
            opts['direction'] = item.course;
        }
        if (item.sidc.charAt(2) === 'A') {
            opts['altitudeDepth'] = item.hae.toFixed(0) + " m";
        }
    }

    let symb = new ms.Symbol(item.sidc, opts);
    return {uri: symb.toDataURL(), x: symb.getAnchor().x, y: symb.getAnchor().y}
}

function getIcon(item, withText) {
    let img = getIconUri(item, 24, withText);

    return L.icon({
        iconUrl: img.uri,
        iconAnchor: [img.x, img.y],
    })
}

function circle(size, color, bg, text) {
    let x = Math.round(size / 2);
    let r = x - 1;

    let s = '<svg width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg"><metadata id="metadata1">image/svg+xml</metadata>';
    s += '<circle style="fill: ' + color + '; stroke: ' + bg + ';" cx="' + x + '" cy="' + x + '" r="' + r + '"/>';

    if (text) {
        let fs = Math.floor(size / 2);
        s += '<text x="50%" y="50%" text-anchor="middle" font-size="' + fs + 'px" font-family="Arial" dy=".3em">' + text + '</text>';
    }
    s += '</svg>';
    return s;
}

function circleWithH(size, color) {
    let x = Math.round(size / 2);
    let r = x - 1;
    
    let s = '<svg width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg">';
    s += '<circle style="fill: ' + color + '; stroke: #000;" cx="' + x + '" cy="' + x + '" r="' + r + '"/>';
    s += '<text x="50%" y="50%" text-anchor="middle" font-size="' + Math.floor(size * 0.6) + 'px" font-family="Arial" font-weight="bold" dy=".3em">H</text>';
    s += '</svg>';
    return s;
}

function circleWithCross(size, color) {
    let x = Math.round(size / 2);
    let r = x - 1;
    
    let s = '<svg width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg">';
    s += '<circle style="fill: white; stroke: ' + color + '; stroke-width: 2;" cx="' + x + '" cy="' + x + '" r="' + r + '"/>';
    // Draw red cross
    let w = size * 0.2;
    let l = size * 0.6;
    s += '<rect x="' + (x - w/2) + '" y="' + (x - l/2) + '" width="' + w + '" height="' + l + '" fill="' + color + '"/>';
    s += '<rect x="' + (x - l/2) + '" y="' + (x - w/2) + '" width="' + l + '" height="' + w + '" fill="' + color + '"/>';
    s += '</svg>';
    return s;
}

function dt(str) {
    if (!str) return "";
    let d = new Date(Date.parse(str));
    return ("0" + d.getDate()).slice(-2) + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
        d.getFullYear() + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
}

function dtShort(str) {
    if (!str) return "";
    let d = new Date(Date.parse(str));
    return ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "." +
        ("0" + d.getFullYear()).slice(-2) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
}

function printCoords(lat, lng) {
    return lat.toFixed(6) + "," + lng.toFixed(6);
}

function toUri(s) {
    return encodeURI("data:image/svg+xml," + s).replaceAll("#", "%23");
}

function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}
