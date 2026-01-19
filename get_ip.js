const os = require('os');
const ifaces = os.networkInterfaces();
Object.keys(ifaces).forEach(ifname => {
    ifaces[ifname].forEach(iface => {
        if ('IPv4' !== iface.family || iface.internal !== false) return;
        console.log(iface.address);
    });
});
