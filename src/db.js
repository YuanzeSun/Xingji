let database;
export async function db() {
  if (database) return database;
  database = await new Promise((resolve, reject) => {
    const req = indexedDB.open('xingji-archive', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('state');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('无法打开本地存储，请检查浏览器是否允许保存网站数据'));
  });
  return database;
}
export async function get(key, fallback) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const req = connection.transaction('state').objectStore('state').get(key);
    req.onsuccess = () => resolve(req.result ?? fallback);
    req.onerror = () => reject(req.error);
  });
}
export async function set(key, value) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('state', 'readwrite');
    tx.objectStore('state').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('本地保存失败，请导出备份并检查设备空间'));
  });
}
export async function setMany(entries) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('state', 'readwrite');
    for (const [key, value] of entries) tx.objectStore('state').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// The callback is synchronous so all reads and writes stay in one IDB transaction.
export async function atomic(keys, update = null) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('state', update ? 'readwrite' : 'readonly'), store = tx.objectStore('state');
    const values = {}; let remaining = keys.length, result, failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('本机数据保存失败'));
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        values[key] = request.result;
        if (--remaining) return;
        try {
          if (!update) { result = values; return; }
          const change = update(values);
          if(change.clear)store.clear();
          for (const [name, value] of Object.entries(change.write || {})) store.put(value, name);
          result = change.result;
        } catch (error) { failure = error; tx.abort(); }
      };
    }
  });
}
