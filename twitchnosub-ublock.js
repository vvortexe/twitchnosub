twitch-nosub.js text/javascript
(function() {
    'use strict';
    if ( /(^|\.)twitch\.tv$/.test(document.location.hostname) === false ) { return; }
    if ( window.__twitchNoSub ) { return; }
    window.__twitchNoSub = true;
    const workerPatch = function() {
        const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        const RESOLUTIONS = [
            [ 'chunked', { name: 'chunked', resolution: 'chunked', frameRate: 60 } ],
            [ '1440p60', { name: '1440p60', resolution: '2560x1440', frameRate: 60 } ],
            [ '1080p60', { name: '1080p60', resolution: '1920x1080', frameRate: 60 } ],
            [ '720p60', { name: '720p60', resolution: '1280x720', frameRate: 60 } ],
            [ '480p30', { name: '480p', resolution: '854x480', frameRate: 30 } ],
            [ '360p30', { name: '360p', resolution: '640x360', frameRate: 30 } ],
            [ '160p30', { name: '160p', resolution: '284x160', frameRate: 30 } ],
        ];
        const oldFetch = self.fetch;
        async function fetchTwitchDataGQL(vodID) {
            const resp = await oldFetch('https://gql.twitch.tv/gql', {
                method: 'POST',
                body: JSON.stringify({
                    query: 'query { video(id: "' + vodID + '") { broadcastType, createdAt, seekPreviewsURL, owner { login } }}'
                }),
                headers: {
                    'Client-Id': CLIENT_ID,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            return resp.json();
        }
        function createServingID() {
            const w = '0123456789abcdefghijklmnopqrstuvwxyz';
            let id = '';
            for ( let i = 0; i < 32; i++ ) {
                id += w[Math.floor(Math.random() * w.length)];
            }
            return id;
        }
        async function isValidQuality(url) {
            const response = await oldFetch(url, { cache: 'force-cache' });
            if ( !response.ok ) { return null; }
            const data = await response.text();
            if ( data.includes('.ts') ) {
                return { codec: 'avc1.4D001E' };
            }
            if ( data.includes('.mp4') ) {
                const mp4Request = await oldFetch(url.replace('index-dvr.m3u8', 'init-0.mp4'), { cache: 'force-cache' });
                if ( mp4Request.ok ) {
                    const content = await mp4Request.text();
                    return { codec: content.includes('hev1') ? 'hev1.1.6.L93.B0' : 'avc1.4D001E' };
                }
                return { codec: 'hev1.1.6.L93.B0' };
            }
            return null;
        }
        async function buildPlaylist(url) {
            const isUsherV2 = url.includes('/vod/v2');
            const vodId = url.split('.m3u8')[0].split('/').at(-1);
            console.log('[TNS] Detected usher ' + (isUsherV2 ? 'v2' : 'v1') + ' for VOD ' + vodId);
            const data = await fetchTwitchDataGQL(vodId);
            if ( !data || !data.data || !data.data.video ) {
                console.log('[TNS] Unable to fetch twitch data API', data);
                return new Response('Unable to fetch twitch data API', { status: 403 });
            }
            const vodData = data.data.video;
            const channelData = vodData.owner;
            if ( !vodData.seekPreviewsURL ) {
                console.log('[TNS] seekPreviewsURL is missing, cannot build playlist', vodData);
                return new Response('Missing seekPreviewsURL', { status: 403 });
            }
            const currentURL = new URL(vodData.seekPreviewsURL);
            const domain = currentURL.host;
            const paths = currentURL.pathname.split('/');
            const vodSpecialID = paths[paths.findIndex(p => p.includes('storyboards')) - 1];
            const broadcastType = vodData.broadcastType.toLowerCase();
            const daysOld = (new Date('2023-02-10').getTime() - new Date(vodData.createdAt).getTime()) / (1000 * 3600 * 24);
            console.log('[TNS] Channel: ' + (channelData && channelData.login) + ', broadcastType: ' + broadcastType + ', domain: ' + domain + ', vodSpecialID: ' + vodSpecialID);
            let playlist = '#EXTM3U\n#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="EU",USER-IP="127.0.0.1",SERVING-ID="' + createServingID() + '",CLUSTER="cloudfront_vod",USER-COUNTRY="BE",MANIFEST-CLUSTER="cloudfront_vod"';
            const playlistUrlFor = resKey => {
                if ( broadcastType === 'highlight' ) {
                    return 'https://' + domain + '/' + vodSpecialID + '/' + resKey + '/highlight-' + vodId + '.m3u8';
                }
                if ( broadcastType === 'upload' && daysOld > 7 ) {
                    return 'https://' + domain + '/' + channelData.login + '/' + vodId + '/' + vodSpecialID + '/' + resKey + '/index-dvr.m3u8';
                }
                return 'https://' + domain + '/' + vodSpecialID + '/' + resKey + '/index-dvr.m3u8';
            };
            const probes = await Promise.all(RESOLUTIONS.map(async ([ resKey, res ]) => {
                const playlistUrl = playlistUrlFor(resKey);
                const result = await isValidQuality(playlistUrl).catch(() => null);
                return { resKey, res, playlistUrl, result };
            }));
            let bandwidth = 8534030;
            for ( const { resKey, res, playlistUrl, result } of probes ) {
                if ( !result ) { continue; }
                console.log('[TNS] Found quality ' + resKey);
                if ( isUsherV2 ) {
                    const variantSource = resKey === 'chunked' ? 'source' : 'transcode';
                    playlist += '\n#EXT-X-STREAM-INF:BANDWIDTH=' + bandwidth + ',CODECS="' + result.codec + ',mp4a.40.2",RESOLUTION=' + res.resolution + ',FRAME-RATE=' + res.frameRate + ',STABLE-VARIANT-ID="' + resKey + '",IVS-NAME="' + res.name + '",IVS-VARIANT-SOURCE="' + variantSource + '"\n' + playlistUrl;
                } else {
                    const enabled = resKey === 'chunked' ? 'YES' : 'NO';
                    playlist += '\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="' + resKey + '",NAME="' + resKey + '",AUTOSELECT=' + enabled + ',DEFAULT=' + enabled;
                    playlist += '\n#EXT-X-STREAM-INF:BANDWIDTH=' + bandwidth + ',CODECS="' + result.codec + ',mp4a.40.2",RESOLUTION=' + res.resolution + ',VIDEO="' + res.name + '",FRAME-RATE=' + res.frameRate + '\n' + playlistUrl;
                }
                bandwidth -= 100;
            }
            if ( !playlist.includes('#EXT-X-STREAM-INF') ) {
                console.log('[TNS] No valid quality found, the VOD CDN structure may have changed');
                return new Response('No valid quality found', { status: 403 });
            }
            console.log('[TNS] Serving generated playlist');
            return new Response(playlist, {
                status: 200,
                headers: { 'Content-Type': 'application/vnd.apple.mpegurl' }
            });
        }
        self.fetch = async function(input, opt) {
            const url = input instanceof Request ? input.url : String(input);
            const response = await oldFetch(input, opt);
            if ( response.ok && url.includes('cloudfront') && url.includes('.m3u8') ) {
                const body = await response.text();
                const headers = new Headers(response.headers);
                headers.delete('content-length');
                headers.delete('content-encoding');
                return new Response(body.replace(/-unmuted/g, '-muted'), {
                    status: response.status,
                    statusText: response.statusText,
                    headers
                });
            }
            if ( url.startsWith('https://usher.ttvnw.net/vod/') && response.status !== 200 ) {
                console.log('[TNS] Usher request intercepted (status ' + response.status + '): ' + url);
                try {
                    return await buildPlaylist(url);
                } catch (e) {
                    console.log('[TNS] Failed to build playlist', e);
                }
            }
            return response;
        };
    };
    const patchSource = '(' + workerPatch.toString() + ')();\n';
    function getWorkerJs(url) {
        const req = new XMLHttpRequest();
        req.open('GET', url, false);
        req.overrideMimeType('text/javascript');
        req.send();
        if ( req.status !== 200 && req.status !== 0 ) { throw new Error('HTTP ' + req.status); }
        return req.responseText;
    }
    const OldWorker = window.Worker;
    window.Worker = class Worker extends OldWorker {
        constructor(url, options) {
            let workerUrl = url;
            if ( String(url).startsWith('blob:') === false ) {
                super(url, options);
                return;
            }
            try {
                const src = getWorkerJs(String(url).replaceAll("'", '%27'));
                workerUrl = URL.createObjectURL(new Blob([ patchSource + src ], { type: 'text/javascript' }));
            } catch (e) {
                console.log('[TNS] Could not patch worker, using original', e);
            }
            super(workerUrl, options);
        }
    };
})();
