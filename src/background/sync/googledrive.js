// Reference:
// - https://developers.google.com/drive/v3/reference/files
// - https://github.com/google/google-api-nodejs-client
import { getUniqId } from 'src/common';
import { objectGet } from 'src/common/object';
import { loadQuery, dumpQuery } from '../utils';
import { getURI, getItemFilename, BaseService, register, isScriptFile } from './base';

const config = {
  client_id: '590447512361-05hjbhnf8ua3iha55e5pgqg15om0cpef.apps.googleusercontent.com',
  redirect_uri: 'https://violentmonkey.github.io/auth_googledrive.html',
};

const GoogleDrive = BaseService.extend({
  name: 'googledrive',
  displayName: 'Google Drive',
  urlPrefix: 'https://www.googleapis.com/drive/v3',
  user() {
    const params = {
      access_token: this.config.get('token'),
    };
    return this.loadData({
      method: 'GET',
      url: `https://www.googleapis.com/oauth2/v3/tokeninfo?${dumpQuery(params)}`,
      responseType: 'json',
    })
    .catch(res => {
      if (res.status === 400 && objectGet(res, 'data.error_description') === 'Invalid Value') {
        return Promise.reject({ type: 'unauthorized' });
      }
      return Promise.reject({
        type: 'error',
        data: res,
      });
    });
  },
  getSyncData() {
    const params = {
      spaces: 'appDataFolder',
      fields: 'files(id,name,size)',
    };
    return this.loadData({
      url: `/files?${dumpQuery(params)}`,
      responseType: 'json',
    })
    .then(({ files }) => {
      let metaFile;
      const remoteData = files.filter(item => {
        if (isScriptFile(item.name)) return true;
        if (!metaFile && item.name === this.metaFile) {
          metaFile = item;
        } else {
          this.remove(item);
        }
        return false;
      })
      .map(normalize)
      .filter(item => {
        if (!item.size) {
          this.remove(item);
          return false;
        }
        return true;
      });
      const metaItem = metaFile ? normalize(metaFile) : {};
      const gotMeta = this.get(metaItem)
      .then(data => JSON.parse(data))
      .catch(err => this.handleMetaError(err))
      .then(data => Object.assign({}, metaItem, {
        data,
        uri: null,
        name: this.metaFile,
      }));
      return Promise.all([gotMeta, remoteData, this.getLocalData()]);
    });
  },
  authorize() {
    const params = {
      response_type: 'token',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
      scope: 'https://www.googleapis.com/auth/drive.appdata',
    };
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${dumpQuery(params)}`;
    browser.tabs.create({ url });
  },
  authorized(raw) {
    const data = loadQuery(raw);
    if (data.access_token) {
      this.config.set({
        token: data.access_token,
      });
    }
  },
  checkAuth(url) {
    const redirectUri = `${config.redirect_uri}#`;
    if (url.startsWith(redirectUri)) {
      this.authorized(url.slice(redirectUri.length));
      this.checkSync();
      return true;
    }
  },
  revoke() {
    this.config.set({
      token: null,
    });
    return this.prepare();
  },
  handleMetaError() {
    return {};
  },
  list() {
    throw new Error('Not supported');
  },
  get({ id }) {
    if (!id) return Promise.reject();
    return this.loadData({
      url: `/files/${id}?alt=media`,
    });
  },
  put(item, data) {
    const name = getItemFilename(item);
    const { id } = item;
    const boundary = getUniqId('violentmonkey-is-great-');
    const headers = {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    };
    const metadata = id ? {
      name,
    } : {
      name,
      parents: ['appDataFolder'],
    };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      data,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const url = id
      ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    return this.loadData({
      url,
      body,
      headers,
      method: id ? 'PATCH' : 'POST',
    });
  },
  remove({ id }) {
    return this.loadData({
      method: 'DELETE',
      url: `/files/${id}`,
    });
  },
});
register(GoogleDrive);

function normalize(item) {
  return {
    id: item.id,
    size: +item.size,
    uri: getURI(item.name),
  };
}