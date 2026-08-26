const mongoose = require('mongoose');
const dns = require('dns');

const FALLBACK_DNS = ['8.8.8.8', '1.1.1.1'];

/**
 * `mongodb+srv://` URIs need a DNS SRV lookup. Node's resolver (c-ares) queries the OS-configured
 * DNS server directly, which fails on some machines (VPN clients / local stub resolvers on 127.0.0.1).
 * If the lookup fails, retry with public DNS servers. Override with DNS_SERVERS=8.8.8.8,1.1.1.1.
 */
async function ensureSrvResolvable(uri) {
  if (!uri.startsWith('mongodb+srv://')) return;
  const host = uri.replace('mongodb+srv://', '').split('@').pop().split('/')[0].split('?')[0];
  const srvName = `_mongodb._tcp.${host}`;
  const resolveSrv = () => new Promise((res, rej) => dns.resolveSrv(srvName, (e, r) => (e ? rej(e) : res(r))));

  if (process.env.DNS_SERVERS) {
    dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
    return;
  }
  try {
    await resolveSrv();
  } catch (err) {
    console.warn(`DNS SRV lookup failed via ${dns.getServers().join(', ')} (${err.code}); retrying with ${FALLBACK_DNS.join(', ')}`);
    dns.setServers(FALLBACK_DNS);
    await resolveSrv(); // throws if still failing -> surfaced by caller
  }
}

module.exports = async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.DATABASE_URL;
  if (!uri) {
    console.error('MONGO_URI is not set. Add it to .env (see .env.example).');
    process.exit(1);
  }
  try {
    await ensureSrvResolvable(uri);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
};
