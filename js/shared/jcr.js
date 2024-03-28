/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* global JSZip */
import { saveFile } from './filesystem.js';

import { config, getContentFrame } from './ui.js';

const getSiteName = () => {
  const gitHubUrl = config.fields['github-project-url'];
  const u = new URL(gitHubUrl);
  return u.pathname.split('/')[2];
};

const getPackageName = (pages) => {
  const siteName = getSiteName();
  if (pages.length === 1) {
    const pageName = pages[0].path.split('/').pop();
    return `${siteName}_${pageName}`;
  }
  return siteName;
};

const getJcrPagePath = (path) => {
  const siteName = getSiteName();
  if (!path.startsWith('/content/')) {
    return `/content/${siteName}${path}`;
  }
  return path;
};

const getJcrAssetPath = (path) => {
  const siteName = getSiteName();
  if (!path.startsWith('/content/dam/')) {
    return `/content/dam/${siteName}${path}`;
  }
  return path;
};

const getMimeType = (url, res) => {
  const contentType = res.headers.get('content-type');
  if (contentType) {
    return contentType;
  }
  const mimeTypes = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    png: 'image/png',
    jpg: 'image/jpeg',
    gif: 'image/gif',
  };
  const extension = url.pathname.split('.').pop();
  return mimeTypes[extension];
};

const getAssetXml = (mimeType) => `<?xml version="1.0" encoding="UTF-8"?>
    <jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:dam="http://www.day.com/dam/1.0" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:mix="http://www.jcp.org/jcr/mix/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:exif="http://ns.adobe.com/exif/1.0/"
        jcr:mixinTypes="[mix:referenceable]"
        jcr:primaryType="dam:Asset">
        <jcr:content
            jcr:primaryType="dam:AssetContent">
            <metadata
                dc:format="${mimeType}"
                jcr:mixinTypes="[cq:Taggable]"
                jcr:primaryType="nt:unstructured"/>
            <related jcr:primaryType="nt:unstructured"/>
        </jcr:content>
    </jcr:root>`;

const getAssetURL = (fileReference, pagePath) => {
  if (!fileReference || fileReference === '') {
    return null;
  }
  // if the fileReference starts with './', use the page path to make it an absolute path
  if (fileReference.startsWith('./')) {
    const parentPath = pagePath.substring(0, pagePath.lastIndexOf('/'));
    // eslint-disable-next-line no-param-reassign
    fileReference = `${parentPath}${fileReference.substring(1)}`;
  }
  // externalize if the fileReference is absolute
  if (fileReference.startsWith('/')) {
    const frame = getContentFrame();
    const { originalURL } = frame.dataset;
    const host = new URL(originalURL).origin;
    return new URL(`${host}${fileReference}`);
  }
  // external fileReference
  return null;
};

// Fetches the asset blob and mime type
const fetchAssetData = async (asset) => {
  if (asset.url) {
    // TODO: remove the query and hash from the fileReference before fetching the image?
    const { blob, mimeType } = await fetch(asset.url.href).then(async (res) => {
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error(`Failed to fetch image: ${res.status}`);
        return { blob: null, mimeType: null };
      }
      return { blob: await res.blob(), mimeType: getMimeType(asset.url, res) };
    });
    asset.blob = blob;
    asset.mimeType = mimeType;
  }
};

const getAsset = (fileReference, pagePath) => {
  const asset = {};
  asset.fileReference = fileReference;
  asset.url = getAssetURL(fileReference, pagePath);
  if (asset.url) {
    asset.jcrPath = getJcrAssetPath(asset.url.pathname);
    asset.jcrFileReference = `${asset.jcrPath}${asset.url.search}${asset.url.hash}`;
  } else {
    asset.jcrFileReference = fileReference;
  }
  return asset;
};

export const getJcrFileReference = (fileReference, pagePath) => {
  const asset = getAsset(fileReference, pagePath);
  return asset.jcrFileReference;
};

const addAsset = async (asset, dirHandle, prefix, zip) => {
  // get asset blob and mime type
  await fetchAssetData(asset);

  // add the image .content.xml file
  const zipAssetPath = `jcr_root${asset.jcrPath}/.content.xml`;
  const fileAssetPath = `${prefix}/${zipAssetPath}`;
  const assetXml = getAssetXml(asset.mimeType);
  await zip.file(zipAssetPath, assetXml);
  await saveFile(dirHandle, fileAssetPath, assetXml);

  // add the image original file
  const zipAssetOriginalPath = `jcr_root${asset.jcrPath}/_jcr_content/renditions/original`;
  const fileAssetOriginalPath = `${prefix}/${zipAssetOriginalPath}`;
  await zip.file(zipAssetOriginalPath, asset.blob);
  await saveFile(dirHandle, fileAssetOriginalPath, asset.blob);
};

const addPage = async (page, dirHandle, prefix, zip) => {
  zip.file(page.contentXmlPath, page.adaptedXml);
  await saveFile(dirHandle, `${prefix}/${page.contentXmlPath}`, page.adaptedXml);
};

const getResourcePaths = (resources) => resources.map((resource) => resource.jcrPath);

const getFilterXml = (dirHandle, prefix, zip, jcrPaths) => {
  const filters = jcrPaths.reduce((acc, path) => `${acc}<filter root='${path}'/>\n`, '');
  const filterXml = `<?xml version='1.0' encoding='UTF-8'?>
    <workspaceFilter version='1.0'>
      ${filters}
    </workspaceFilter>`;
  const filterXmlPath = 'META-INF/vault/filter.xml';
  return { filterXmlPath, filterXml };
};

const getPropertiesXml = (dirHandle, prefix, zip, pages, packageName) => {
  const author = 'anonymous';
  const now = new Date().toISOString();
  const propXml = `<?xml version='1.0' encoding='UTF-8'?>
    <!DOCTYPE properties SYSTEM 'http://java.sun.com/dtd/properties.dtd'>
    <properties>
    <comment>FileVault Package Properties</comment>
    <entry key='description'></entry>
    <entry key='generator'>org.apache.jackrabbit.vault:3.7.1-T20231005151103-335689a8</entry>
    <entry key='packageType'>content</entry>
    <entry key='lastWrappedBy'>${author}</entry>
    <entry key='packageFormatVersion'>2</entry>
    <entry key='group'>my_packages</entry>
    <entry key='created'>${now}</entry>
    <entry key='lastModifiedBy'>${author}</entry>
    <entry key='buildCount'>1</entry>
    <entry key='lastWrapped'>${now}</entry>
    <entry key='version'></entry>
    <entry key='dependencies'></entry>
    <entry key='createdBy'>${author}</entry>
    <entry key='name'>${packageName}</entry>
    <entry key='lastModified'>${now}</entry>
    </properties>`;
  const propXmlPath = 'META-INF/vault/properties.xml';
  return { propXmlPath, propXml };
};

// Updates the asset references in the JCR XML
export const updateJcr = (xml, pagePath) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const assets = doc.querySelectorAll('[fileReference]');
  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i];
    const fileReference = asset.getAttribute('fileReference');
    const jcrFileReference = getJcrFileReference(fileReference, pagePath);
    asset.setAttribute('fileReference', jcrFileReference);
  }
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
};

const getJcrPages = (pages) => pages.map((page) => {
  const pageObj = {};
  pageObj.path = page.path;
  pageObj.originalXml = page.data;
  pageObj.adaptedXml = updateJcr(page.data, page.path);
  pageObj.jcrPath = getJcrPagePath(page.path);
  pageObj.contentXmlPath = `jcr_root${pageObj.jcrPath}/.content.xml`;
  return pageObj;
});

const getJcrAssets = (pages) => {
  const jcrAssets = [];
  const jcrPages = getJcrPages(pages);
  for (let i = 0; i < jcrPages.length; i += 1) {
    const page = jcrPages[i];
    const parser = new DOMParser();
    const doc = parser.parseFromString(page.originalXml, 'application/xml');
    const images = doc.querySelectorAll('[fileReference]');
    for (let j = 0; j < images.length; j += 1) {
      const image = images[j];
      const fileReference = image.getAttribute('fileReference');
      const asset = getAsset(fileReference, page.path);
      // skip if the link points to an AEM asset
      if (asset.url && !asset.url.pathname.startsWith('/content/dam/')) {
        jcrAssets.push(asset);
      }
    }
  }
  return jcrAssets;
};

const getJcrPaths = (pages) => {
  const jcrPages = getJcrPages(pages);
  const jcrAssets = getJcrAssets(pages);
  const jcrPaths = [];
  jcrPaths.push(...getResourcePaths(jcrPages));
  jcrPaths.push(...getResourcePaths(jcrAssets));
  return jcrPaths;
};

const addFilterXml = async (pages, dirHandle, prefix, zip) => {
  const jcrPaths = getJcrPaths(pages);
  const { filterXmlPath, filterXml } = getFilterXml(dirHandle, prefix, zip, jcrPaths);
  zip.file(filterXmlPath, filterXml);
  await saveFile(dirHandle, `${prefix}/${filterXmlPath}`, filterXml);
};

const addPropertiesXml = async (dirHandle, prefix, zip, pages, packageName) => {
  const { propXmlPath, propXml } = getPropertiesXml(dirHandle, prefix, zip, pages, packageName);
  zip.file(propXmlPath, propXml);
  await saveFile(dirHandle, `${prefix}/${propXmlPath}`, propXml);
};

export const createJcrPackage = async (dirHandle, pages) => {
  if (pages.length === 0) return;
  const packageName = getPackageName(pages);
  const zip = new JSZip();
  const prefix = 'jcr';

  // add the pages
  const jcrPages = getJcrPages(pages);
  for (let i = 0; i < jcrPages.length; i += 1) {
    const page = jcrPages[i];
    // eslint-disable-next-line no-await-in-loop
    await addPage(page, dirHandle, prefix, zip);
  }

  // add the assets
  const jcrAssets = getJcrAssets(pages);
  for (let i = 0; i < jcrAssets.length; i += 1) {
    const asset = jcrAssets[i];
    // eslint-disable-next-line no-await-in-loop
    await addAsset(asset, dirHandle, prefix, zip);
  }

  // add the filter.xml file
  await addFilterXml(pages, dirHandle, prefix, zip);

  // add the properties.xml file
  await addPropertiesXml(dirHandle, prefix, zip, pages, packageName);

  // save the zip file
  zip.generateAsync({ type: 'blob' })
    .then(async (blob) => {
      await saveFile(dirHandle, `${prefix}/${packageName}.zip`, blob);
    });
};
