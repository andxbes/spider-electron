const EXTRACT_TEXT_REMOVE_SELECTOR = 'script, style, svg, noscript, template, iframe, [aria-hidden="true"]';

function normalizeExtractedText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractElementText($, el) {
    const clone = $(el).clone();
    clone.find(EXTRACT_TEXT_REMOVE_SELECTOR).remove();
    return normalizeExtractedText(clone.text());
}

function collectMetaAttributeValues($, selector) {
    const values = [];
    const seen = new Set();
    $(selector).each((_, el) => {
        const value = ($(el).attr('content') || '').trim();
        if (!value) {
            return;
        }
        const key = value.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        values.push(value);
    });
    return values;
}

function extractPageTitle($) {
    let titleEl = $('head > title').first();
    if (!titleEl.length) {
        titleEl = $('title').first();
    }
    let title = titleEl.length ? extractElementText($, titleEl.get(0)) : '';
    if (!title) {
        title = ($('head meta[property="og:title"]').attr('content')
            || $('meta[property="og:title"]').attr('content')
            || $('meta[name="twitter:title"]').attr('content')
            || '').trim();
    }
    return title;
}

function extractMetaDescription($) {
    const values = collectMetaAttributeValues($, 'head meta[name="description"]');
    if (!values.length) {
        return collectMetaAttributeValues($, 'meta[name="description"]').join('; ');
    }
    return values.join('; ');
}

function extractHeadings($) {
    const headings = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
        const text = extractElementText($, el);
        if (!text) {
            return;
        }
        headings.push({
            level: parseInt(el.tagName.substring(1), 10),
            text,
        });
    });
    return headings;
}

function getXRobotsTag(response) {
    return response.headers.get('x-robots-tag') || '';
}

function extractMetaRobotsRaw($, response) {
    let values = collectMetaAttributeValues($, 'head meta[name="robots"], head meta[name="googlebot"]');
    if (!values.length) {
        values = collectMetaAttributeValues($, 'meta[name="robots"], meta[name="googlebot"]');
    }
    const xRobots = getXRobotsTag(response).trim();
    if (xRobots && !values.some((value) => value.toLowerCase() === xRobots.toLowerCase())) {
        values.push(xRobots);
    }
    return values.join('; ');
}

module.exports = {
    EXTRACT_TEXT_REMOVE_SELECTOR,
    normalizeExtractedText,
    extractElementText,
    collectMetaAttributeValues,
    extractPageTitle,
    extractMetaDescription,
    extractHeadings,
    getXRobotsTag,
    extractMetaRobotsRaw,
};
