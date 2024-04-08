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

/* eslint-env mocha */
// eslint-disable-next-line import/no-extraneous-dependencies
import { JSDOM } from 'jsdom';
import assert from 'assert';
import {
  getProcessedFileRef,
  getJcrPages,
  getJcrAssets,
  getJcrPaths,
  getPackageName,
} from '../js/shared/jcr.js';

const dom = new JSDOM();
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;

// test cases and expected results
const testData = {
  projectUrl: 'https://raw.githubusercontent.com/user/repo/main',
  pages: [
    {
      url: 'https://www.brand.com/1/2/page.html',
      images: [
        {
          description: 'relative path to the page',
          fileReference: './a/b/media.png?name1=value1&name2=value2',
          expected: {
            jcrPath: '/content/dam/repo/1/2/a/b/media.png',
            processedFileRef: '/content/dam/repo/1/2/a/b/media.png?name1=value1&name2=value2',
            url: new URL('https://www.brand.com/1/2/a/b/media.png?name1=value1&name2=value2'),
          },
        },
        {
          description: 'absolute path',
          fileReference: '/a/b/media.png?name1=value1&name2=value2',
          expected: {
            jcrPath: '/content/dam/repo/a/b/media.png',
            processedFileRef: '/content/dam/repo/a/b/media.png?name1=value1&name2=value2',
            url: new URL('https://www.brand.com/a/b/media.png?name1=value1&name2=value2'),
          },
        },
      ],
      expected: {
        jcrPath: '/content/repo/1/2/page',
        contentXmlPath: 'jcr_root/content/repo/1/2/page/.content.xml',
      },
    },
    {
      url: 'https://www.brand.com/3/4/page.html',
      images: [
        {
          description: 'full URL',
          fileReference: 'https://www.another.com/a/b/media.png?name1=value1&name2=value2',
          expected: {
            jcrPath: null,
            processedFileRef: 'https://www.another.com/a/b/media.png?name1=value1&name2=value2',
            url: null,
          },
        },
        {
          description: 'below /content/dam',
          fileReference: '/content/dam/a/b/media.png?name1=value1&name2=value2',
          expected: {
            jcrPath: null,
            processedFileRef: '/content/dam/a/b/media.png?name1=value1&name2=value2',
            url: null,
          },
        },
      ],
      expected: {
        jcrPath: '/content/repo/3/4/page',
        contentXmlPath: 'jcr_root/content/repo/3/4/page/.content.xml',
      },
    },
  ],
};

const pageXml = (fileRef) => `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="cq:Page">
      <jcr:content cq:template="/libs/core/franklin/templates/page" jcr:primaryType="cq:PageContent" jcr:title="Sites Franklin Example" sling:resourceType="core/franklin/components/page/v1/page">
        <root jcr:primaryType="nt:unstructured" sling:resourceType="core/franklin/components/root/v1/root">
          <section sling:resourceType="core/franklin/components/section/v1/section" jcr:primaryType="nt:unstructured">
            <image_0 sling:resourceType="core/franklin/components/image/v1/image" jcr:primaryType="nt:unstructured" alt="" fileReference="${fileRef[0].replace('&', '&amp;')}"/>
            <image_1 sling:resourceType="core/franklin/components/image/v1/image" jcr:primaryType="nt:unstructured" alt="" fileReference="${fileRef[1].replace('&', '&amp;')}"/>
            <button_0 sling:resourceType="core/franklin/components/button/v1/button" jcr:primaryType="nt:unstructured" type="primary" href="/acrobat/free-trial-download.html" text="7-day free trial"/>
          </section>
        </root>
      </jcr:content>
    </jcr:root>`;

const testPages = testData.pages.map((page) => ({
  path: new URL(page.url).pathname.split('.html')[0],
  data: pageXml(page.images.map((image) => image.fileReference)),
  url: page.url,
}));

describe('JCR Importer', () => {
  it('should return the correct JCR package name', () => {
    assert.deepEqual(getPackageName(testPages, testData.projectUrl), 'repo', 'Package name is not as expected');
  });

  it('should return the correct JCR processed fileReference', () => {
    const testGetProcessedFileRef = (projectUrl, pageUrl, fileReference, expected) => {
      const pagePath = new URL(pageUrl).pathname;
      const result = getProcessedFileRef(fileReference, pagePath, pageUrl, projectUrl);
      assert.equal(result, expected, `Processed file reference is not as expected for ${fileReference}`);
    };

    testData.pages.forEach((page) => {
      page.images.forEach((image) => {
        const { fileReference, expected } = image;
        const pageUrl = page.url;
        // eslint-disable-next-line max-len
        testGetProcessedFileRef(testData.projectUrl, pageUrl, fileReference, expected.processedFileRef);
      });
    });
  });

  it('should return the correct JCR pages', () => {
    const expectedPages = testData.pages.map((page) => ({
      path: new URL(page.url).pathname.split('.html')[0],
      sourceXml: pageXml(page.images.map((image) => image.fileReference)),
      processedXml: pageXml(page.images.map((image) => image.expected.processedFileRef)),
      jcrPath: page.expected.jcrPath,
      contentXmlPath: page.expected.contentXmlPath,
      url: page.url,
    }));
    assert.deepEqual(getJcrPages(testPages, testData.projectUrl), expectedPages, 'JCR pages are not as expected');
  });

  it('should return the correct JCR assets', () => {
    const expectedAssets = testData.pages
      .flatMap((page) => page.images)
      .map((image) => ({
        fileReference: image.fileReference,
        jcrPath: image.expected.jcrPath,
        processedFileRef: image.expected.processedFileRef,
        url: image.expected.url,
      }))
      .filter((image) => image.jcrPath !== null);
    assert.deepEqual(getJcrAssets(testPages, testData.projectUrl), expectedAssets, 'JCR assets are not as expected');
  });

  it('should return the correct JCR paths', () => {
    const expectedPaths = [
      ...testData.pages.map((page) => page.expected.jcrPath),
      ...testData.pages.flatMap((page) => page.images
        .map((image) => image.expected.jcrPath).filter((path) => path !== null)),
    ];
    assert.deepEqual(getJcrPaths(testPages, testData.projectUrl), expectedPaths, 'JCR paths are not as expected');
  });
});
