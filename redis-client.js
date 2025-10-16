class RedisCache {
  constructor({ prefix = 'cache:', redisUrl = 'redis://localhost:6379' } = {}) {
    this.prefix = prefix;
    this.redisUrl = redisUrl;
    this.connected = false;
    this.redisClient = null;
    this.storage = typeof window !== 'undefined' && window.localStorage 
      ? window.localStorage 
      : new Map();
    
    this.ready = this.init();
  }

  async init() {
    try {
      if (typeof window === 'undefined') {
        const redis = require('redis');
        this.redisClient = redis.createClient({ url: this.redisUrl });
        await this.redisClient.connect();
        this.connected = true;
      }
    } catch {
      this.connected = false;
    }
  }

  _key(key) {
    return this.prefix + key;
  }

  async set(key, data, ttl = 300) {
    await this.ready;
    try {
      const k = this._key(key);
      
      if (this.connected) {
        const payload = JSON.stringify(data);
        return ttl 
          ? await this.redisClient.setEx(k, ttl, payload)
          : await this.redisClient.set(k, payload);
      } else {
        const item = {
          data,
          expires: ttl ? Date.now() + ttl * 1000 : null
        };
        this.storage.setItem(k, JSON.stringify(item));
        return true;
      }
    } catch {
      return false;
    }
  }

  async get(key) {
    await this.ready;
    try {
      const k = this._key(key);
      
      if (this.connected) {
        const result = await this.redisClient.get(k);
        return result ? JSON.parse(result) : null;
      } else {
        const raw = this.storage.getItem(k);
        if (!raw) return null;
        
        const parsed = JSON.parse(raw);
        if (parsed.expires && Date.now() > parsed.expires) {
          this.storage.removeItem(k);
          return null;
        }
        return parsed.data;
      }
    } catch {
      return null;
    }
  }

  async delete(key) {
    await this.ready;
    try {
      const k = this._key(key);
      
      if (this.connected) {
        await this.redisClient.del(k);
      } else {
        this.storage.removeItem(k);
      }
      return true;
    } catch {
      return false;
    }
  }

  async deleteByPrefix(subPrefix) {
    await this.ready;
    try {
      const pattern = this.prefix + subPrefix;
      
      if (this.connected) {
        const keys = await this.redisClient.keys(pattern + '*');
        if (keys.length > 0) await this.redisClient.unlink(keys);
      } else {
        for (let i = this.storage.length - 1; i >= 0; i--) {
          const key = this.storage.key(i);
          if (key && key.startsWith(pattern)) {
            this.storage.removeItem(key);
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async clear() {
    await this.ready;
    try {
      if (this.connected) {
        const keys = await this.redisClient.keys(this.prefix + '*');
        if (keys.length > 0) await this.redisClient.unlink(keys);
      } else {
        for (let i = this.storage.length - 1; i >= 0; i--) {
          const key = this.storage.key(i);
          if (key && key.startsWith(this.prefix)) {
            this.storage.removeItem(key);
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async ping() {
    await this.ready;
    return this.connected 
      ? await this.redisClient.ping() 
      : 'LocalStorage OK';
  }

  getStatus() {
    return this.connected 
      ? 'Redis Server Connected' 
      : 'Redis Fallback Mode (localStorage)';
  }

  async getStats() {
    await this.ready;
    try {
      const stats = {
        connected: this.connected,
        backend: this.connected ? 'Redis Server' : 'localStorage',
        prefix: this.prefix
      };
      
      if (this.connected) {
        stats.redisInfo = await this.redisClient.info();
      } else {
        const keys = [];
        for (let i = 0; i < this.storage.length; i++) {
          const key = this.storage.key(i);
          if (key && key.startsWith(this.prefix)) keys.push(key);
        }
        stats.cachedItems = keys.length;
        stats.keys = keys;
      }
      return stats;
    } catch (e) {
      return { error: e.message };
    }
  }

  async close() {
    await this.ready;
    if (this.connected && this.redisClient) {
      await this.redisClient.quit();
      this.connected = false;
    }
  }
}

if (typeof window !== 'undefined') {
  window.cache = new RedisCache();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RedisCache;
}
