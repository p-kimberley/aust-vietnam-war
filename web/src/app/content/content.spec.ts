import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { RESPONSE_INIT, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UrlSegment, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { SITE_URL, Seo } from '../core/seo.service';
import { ArticleList } from './article-list';
import { ArticlePage } from './article-page';
import { CmsBody } from './cms-body';
import { CmsPage, cmsPageMatcher } from './cms-page';
import { ArticleCard, ArticleView, PageView } from './content';
import { Home } from '../pages/home';

const card = (slug: string, over: Partial<ArticleCard> = {}): ArticleCard => ({
  slug,
  title: `Title ${slug}`,
  excerpt: `Excerpt ${slug}`,
  publishedUtc: '2026-03-04T10:00:00Z',
  authorName: 'Ann Author',
  categorySlug: 'battles',
  categoryName: 'Battles',
  imageUrl: null,
  imageCaption: null,
  ...over,
});

const article: ArticleView = {
  ...card('long-tan', { imageUrl: '/media/aa/abc.jpg', imageCaption: 'A patrol' }),
  bodyHtml: '<p>Body text.</p><iframe src="https://player.vimeo.com/video/1"></iframe><h2>Sub</h2>',
  updatedUtc: '2026-03-05T10:00:00Z',
  seoTitle: null,
  seoDescription: null,
  tags: [{ slug: 'nui-dat', name: 'Nui Dat' }],
  related: [card('coral')],
};

const page: PageView = {
  title: 'Team',
  path: 'about/team',
  bodyHtml: '<p>Who we are.</p>',
  updatedUtc: '2026-03-05T10:00:00Z',
  seoTitle: 'Our team',
  seoDescription: 'The people behind the site.',
  breadcrumbs: [{ title: 'About', path: 'about' }],
  children: [{ title: 'Volunteers', path: 'about/team/volunteers' }],
};

function setup(providers: unknown[] = []) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SITE_URL, useValue: 'https://avw.example' },
      ...(providers as never[]),
    ],
  });
  return TestBed.inject(HttpTestingController);
}

/** httpResource sends its request from an effect, so give the component a few turns to ask. */
async function nextRequests(fixture: ComponentFixture<unknown>, ctl: HttpTestingController, match: (url: string) => boolean, count = 1): Promise<TestRequest[]> {
  const found: TestRequest[] = [];
  for (let i = 0; i < 20 && found.length < count; i++) {
    fixture.detectChanges();
    found.push(...ctl.match((r) => match(r.url)));
    if (found.length < count) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (found.length < count) {
    throw new Error(`The component made ${found.length} of the ${count} expected requests.`);
  }
  return found;
}

const nextRequest = async (fixture: ComponentFixture<unknown>, ctl: HttpTestingController, match: (url: string) => boolean) =>
  (await nextRequests(fixture, ctl, match))[0];

const settled = async (fixture: ComponentFixture<unknown>) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
};

describe('cmsPageMatcher', () => {
  const match = (...paths: string[]) => cmsPageMatcher(paths.map((p) => new UrlSegment(p, {})), null as never, null as never);

  it('hands the whole path to the page', () => {
    expect(match('about')?.posParams?.['path'].path).toBe('about');
    expect(match('about', 'team')?.posParams?.['path'].path).toBe('about/team');
  });

  it('leaves the application and infrastructure paths alone, and the home page', () => {
    for (const reserved of ['api', 'studio', 'battlemap', 'articles', 'media', 'forbidden', 'feed.xml', 'sitemap.xml', 'vendor', 'assets']) {
      expect(match(reserved, 'x'), reserved).toBeNull();
    }
    expect(match()).toBeNull();
  });
});

describe('CmsBody', () => {
  it('keeps the frames and formatting the API allows, which Angular would strip on its own', () => {
    setup();
    const fixture = TestBed.createComponent(CmsBody);
    fixture.componentRef.setInput('html', article.bodyHtml);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('p')?.textContent).toBe('Body text.');
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('https://player.vimeo.com/video/1');
    expect(el.querySelector('h2')?.textContent).toBe('Sub');
  });
});

describe('ArticlePage', () => {
  it('shows the article, its image, tags and related stories, and sets the page metadata', async () => {
    const ctl = setup();
    const fixture = TestBed.createComponent(ArticlePage);
    fixture.componentRef.setInput('slug', 'long-tan');

    (await nextRequest(fixture, ctl, (u) => u === '/api/content/articles/long-tan')).flush(article);
    const el = await settled(fixture);

    expect(el.querySelector('h1')?.textContent).toBe('Title long-tan');
    expect(el.textContent).toContain('4 March 2026');
    expect(el.textContent).toContain('Ann Author');
    expect(el.querySelector('figure img')?.getAttribute('src')).toBe('/media/aa/abc.jpg');
    expect(el.querySelector('.prose iframe')).not.toBeNull();
    expect(el.textContent).toContain('Nui Dat');
    expect(el.querySelectorAll('app-article-card')).toHaveLength(1);

    const head = document.head;
    expect(document.title).toBe('Title long-tan · Australia\'s Vietnam War');
    expect(head.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe('https://avw.example/articles/long-tan');
    expect(head.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('article');
    expect(head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://avw.example/media/aa/abc.jpg');
    const ld = JSON.parse(head.querySelector('#avw-json-ld')!.textContent!);
    expect(ld).toMatchObject({ '@type': 'Article', headline: 'Title long-tan', author: { name: 'Ann Author' } });
  });

  it('shows Not found, with a 404 status while rendering on the server, when there is no such article', async () => {
    const init: ResponseInit = {};
    const ctl = setup([{ provide: RESPONSE_INIT, useValue: init }]);
    const fixture = TestBed.createComponent(ArticlePage);
    fixture.componentRef.setInput('slug', 'nope');

    (await nextRequest(fixture, ctl, (u) => u.endsWith('/nope'))).flush('', { status: 404, statusText: 'Not Found' });
    const el = await settled(fixture);

    expect(el.textContent).toContain('Page not found');
    expect(init.status).toBe(404);
  });

  it('says so, rather than "not found", when the API fails', async () => {
    const ctl = setup();
    const fixture = TestBed.createComponent(ArticlePage);
    fixture.componentRef.setInput('slug', 'boom');

    (await nextRequest(fixture, ctl, (u) => u.endsWith('/boom'))).flush('', { status: 500, statusText: 'Server Error' });
    const el = await settled(fixture);

    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not be loaded');
    expect(el.textContent).not.toContain('Page not found');
  });

  it('escapes a script-ending title in the structured data', async () => {
    const ctl = setup();
    const fixture = TestBed.createComponent(ArticlePage);
    fixture.componentRef.setInput('slug', 'evil');

    (await nextRequest(fixture, ctl, (u) => u.endsWith('/evil'))).flush({ ...article, title: '</script><script>alert(1)</script>' });
    await settled(fixture);

    const raw = document.head.querySelector('#avw-json-ld')!.textContent!;
    expect(raw).not.toContain('</script>');
    expect(JSON.parse(raw).headline).toBe('</script><script>alert(1)</script>');
  });
});

describe('CmsPage', () => {
  it('shows a nested page with breadcrumbs and its child pages, using the SEO title', async () => {
    const ctl = setup();
    const fixture = TestBed.createComponent(CmsPage);
    fixture.componentRef.setInput('path', 'about/team');

    (await nextRequest(fixture, ctl, (u) => u === '/api/content/page/about/team')).flush(page);
    const el = await settled(fixture);

    expect(el.querySelector('h1')?.textContent).toBe('Team');
    expect(el.querySelector('.crumbs a')?.getAttribute('href')).toBe('/about');
    expect(el.querySelector('.children a')?.getAttribute('href')).toBe('/about/team/volunteers');
    expect(document.title).toBe("Our team · Australia's Vietnam War");
    expect(document.head.querySelector('meta[name=description]')?.getAttribute('content')).toBe('The people behind the site.');
  });

  it('shows Not found for a path that is not a published page', async () => {
    const init: ResponseInit = {};
    const ctl = setup([{ provide: RESPONSE_INIT, useValue: init }]);
    const fixture = TestBed.createComponent(CmsPage);
    fixture.componentRef.setInput('path', 'missing');

    (await nextRequest(fixture, ctl, (u) => u === '/api/content/page/missing')).flush('', { status: 404, statusText: 'Not Found' });
    const el = await settled(fixture);

    expect(el.textContent).toContain('Page not found');
    expect(init.status).toBe(404);
  });
});

describe('ArticleList', () => {
  it('asks for the chosen category and page, and links to the neighbouring pages', async () => {
    const ctl = setup();
    const fixture = TestBed.createComponent(ArticleList);
    fixture.componentRef.setInput('category', 'battles');
    fixture.componentRef.setInput('page', '2');

    const list = await nextRequest(fixture, ctl, (u) => u === '/api/content/articles');
    expect(list.request.params.get('category')).toBe('battles');
    expect(list.request.params.get('page')).toBe('2');
    list.flush({ items: [card('a'), card('b')], total: 30, page: 2, pageSize: 12 });
    (await nextRequest(fixture, ctl, (u) => u === '/api/content/categories')).flush([{ id: 1, slug: 'battles', name: 'Battles' }]);
    const el = await settled(fixture);

    expect(el.querySelectorAll('app-article-card')).toHaveLength(2);
    expect(el.querySelector('.chip.is-on')?.textContent).toBe('Battles');
    const pager = el.querySelector('.pager')!;
    expect(pager.textContent).toContain('Page 2 of 3');
    expect(pager.querySelector('a[rel=prev]')).not.toBeNull();
    expect(pager.querySelector('a[rel=next]')).not.toBeNull();
    expect(document.title).toBe("Stories: Battles · Australia's Vietnam War");
  });

  it('says so when nothing has been published', async () => {
    const ctl = setup();
    const fixture = TestBed.createComponent(ArticleList);

    (await nextRequest(fixture, ctl, (u) => u === '/api/content/articles')).flush({ items: [], total: 0, page: 1, pageSize: 12 });
    (await nextRequest(fixture, ctl, (u) => u === '/api/content/categories')).flush([]);
    const el = await settled(fixture);

    expect(el.textContent).toContain('No stories have been published here yet.');
    expect(el.querySelector('.pager')).toBeNull();
  });
});

describe('Home', () => {
  it('shows featured and latest stories when there are some, and only the tiles when there are none', async () => {
    const ctl = setup();
    const fixture = TestBed.createComponent(Home);

    const both = await nextRequests(fixture, ctl, (u) => u === '/api/content/articles', 2);
    const f = both.find((r) => r.request.params.has('featured'))!;
    const l = both.find((r) => !r.request.params.has('featured'))!;
    f.flush({ items: [card('f1')], total: 1, page: 1, pageSize: 3 });
    l.flush({ items: [card('l1'), card('l2')], total: 2, page: 1, pageSize: 6 });
    const el = await settled(fixture);

    expect(el.querySelector('#featured-title')).not.toBeNull();
    expect(el.querySelectorAll('.stories app-article-card')).toHaveLength(3);
    expect(TestBed.inject(Seo).absolute('/')).toBe('https://avw.example/');
  });

  it('shows no story sections before anything is published', async () => {
    const ctl = setup();
    const fixture = TestBed.createComponent(Home);

    const requests = await nextRequests(fixture, ctl, (u) => u === '/api/content/articles', 2);
    requests.forEach((r) => r.flush({ items: [], total: 0, page: 1, pageSize: 6 }));
    const el = await settled(fixture);

    expect(el.querySelector('.stories')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('Vietnam War');
  });
});
