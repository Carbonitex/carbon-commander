/**
 * Pure DOM functions for chrome.scripting.executeScript.
 * Each function runs in the tab context and must be fully self-contained:
 * - No imports, no closures, no external references
 * - Arguments must be serializable
 * - Return values must be serializable (no DOM nodes, no functions)
 */

// ── GeneralTools ──

export function domGetPageMetadata() {
    try {
        return {
            success: true,
            result: {
                title: document.title,
                description: document.querySelector('meta[name="description"]')?.content,
                keywords: document.querySelector('meta[name="keywords"]')?.content,
                author: document.querySelector('meta[name="author"]')?.content,
                url: window.location.href,
                domain: window.location.hostname,
                lastModified: document.lastModified,
                language: document.documentElement.lang,
                charset: document.characterSet,
                viewport: document.querySelector('meta[name="viewport"]')?.content
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domExtractPageContent(args) {
    const { include_images = false, include_links = false, include_html = false, body_query_selector } = args || {};
    try {
        let mainContent = document.querySelector('article, [role="main"], main, .main-content, #main-content') || document.body;
        if (body_query_selector) {
            mainContent = document.querySelector(body_query_selector);
        }

        const wordLimit = 10000;
        const charLimit = wordLimit * 5;
        const charCount = mainContent.textContent.trim().length;
        const wordCount = mainContent.textContent.trim().split(/\s+/).length;

        if (charCount > charLimit || wordCount > wordLimit) {
            const trimmedContent = mainContent.textContent.trim().slice(0, 5000);
            return {
                success: true,
                content: `${trimmedContent}\n\nContent is too long. The output has been limited. Try again with a more specific query or use the body_query_selector to target a specific part of the page.\nChar count: ${trimmedContent.length} / ${charCount}, Word count: ${trimmedContent.split(/\s+/).length} / ${wordCount}`
            };
        }

        const content = {
            text: mainContent.textContent.trim(),
            wordCount: wordCount,
            html: include_html ? mainContent.innerHTML : null
        };

        if (include_images) {
            content.images = Array.from(mainContent.querySelectorAll('img')).map(img => ({
                src: img.src, alt: img.alt, width: img.width, height: img.height
            }));
        }

        if (include_links) {
            content.links = Array.from(mainContent.querySelectorAll('a')).map(link => ({
                text: link.textContent.trim(), href: link.href, title: link.title
            }));
        }

        return { success: true, result: content };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domSecurityCheck(args) {
    const { include_headers = true, check_ssl = true } = args || {};
    try {
        const securityReport = {
            url: window.location.href,
            protocol: window.location.protocol,
            isSecure: window.location.protocol === 'https:',
            timestamp: new Date().toISOString()
        };

        // Note: header check via fetch is async and can't be done in synchronous executeScript
        // We skip header analysis in the worker path

        if (check_ssl && window.location.protocol === 'https:') {
            securityReport.sslCertificate = {
                issuer: 'Not available in client',
                validFrom: 'Not available in client',
                validTo: 'Not available in client'
            };
        }

        securityReport.securityIssues = [];

        if (!securityReport.isSecure) {
            securityReport.securityIssues.push({
                severity: 'high',
                issue: 'Site does not use HTTPS',
                recommendation: 'Enable HTTPS to secure data transmission'
            });
        }

        const mixedContent = Array.from(document.querySelectorAll('img, script, link, iframe'))
            .filter(el => {
                const src = el.src || el.href;
                return src && src.startsWith('http:');
            });
        if (mixedContent.length > 0) {
            securityReport.securityIssues.push({
                severity: 'medium',
                issue: 'Mixed content detected',
                details: `${mixedContent.length} resources loaded over insecure HTTP`,
                recommendation: 'Update resource URLs to use HTTPS'
            });
        }

        const passwordFields = Array.from(document.querySelectorAll('input[type="password"]'));
        const insecurePasswordFields = passwordFields.filter(field => !field.closest('form')?.hasAttribute('autocomplete'));
        if (insecurePasswordFields.length > 0) {
            securityReport.securityIssues.push({
                severity: 'medium',
                issue: 'Insecure password fields detected',
                details: `${insecurePasswordFields.length} password fields without proper autocomplete attributes`,
                recommendation: 'Add autocomplete attributes to password fields'
            });
        }

        return { success: true, result: securityReport };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domPageInteract(args) {
    const { action, selector, text_content, wait_for_navigation = false, timeout = 5000 } = args;
    try {
        let element = null;

        if (selector) {
            element = document.querySelector(selector);
        } else if (text_content) {
            const elements = Array.from(document.querySelectorAll('*'));
            element = elements.find(el =>
                el.textContent?.trim() === text_content.trim() ||
                el.value === text_content ||
                el.placeholder === text_content
            );
        }

        if (!element) {
            return { success: false, error: `Element not found: ${selector || text_content}` };
        }

        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        switch (action) {
            case 'click': element.click(); break;
            case 'hover':
                element.dispatchEvent(new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true }));
                break;
            case 'focus': element.focus(); break;
        }

        return {
            success: true,
            result: {
                action,
                element: {
                    tagName: element.tagName, id: element.id,
                    className: element.className, text: element.textContent?.trim()
                }
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domInputText(args) {
    const { selector, placeholder_text, text, submit = false, clear_first = true } = args;
    try {
        let element = null;

        if (selector) {
            element = document.querySelector(selector);
        } else if (placeholder_text) {
            element = Array.from(document.querySelectorAll('input, textarea')).find(el =>
                el.placeholder === placeholder_text
            );
        }

        if (!element) {
            return { success: false, error: `Input element not found: ${selector || placeholder_text}` };
        }

        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.focus();

        if (clear_first) {
            if (element.isContentEditable) { element.textContent = ''; }
            else { element.value = ''; }
        }

        if (element.isContentEditable) { element.textContent = text; }
        else { element.value = text; }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        if (submit && element.form) { element.form.submit(); }

        return {
            success: true,
            result: {
                element: {
                    tagName: element.tagName, id: element.id,
                    className: element.className, value: element.value || element.textContent
                },
                text_entered: text
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domNavigateTo(args) {
    const { url, preserve_hash = false, replace_state = false } = args;
    try {
        let targetUrl;
        if (url.startsWith('/') || !url.includes('://')) {
            targetUrl = new URL(url, window.location.origin);
        } else {
            targetUrl = new URL(url);
        }

        if (!['http:', 'https:'].includes(targetUrl.protocol)) {
            return { success: false, error: `Invalid protocol: ${targetUrl.protocol}` };
        }

        if (preserve_hash && window.location.hash && !url.includes('#')) {
            targetUrl.hash = window.location.hash;
        }

        const previousUrl = window.location.href;
        if (replace_state) {
            window.location.replace(targetUrl.href);
        } else {
            window.location.href = targetUrl.href;
        }

        return { success: true, result: { url: targetUrl.href, previousUrl } };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ── LinkedIn Tools ──

export function domGetLinkedInProfile(args) {
    const { include_recommendations = false } = args || {};
    try {
        const profile = {
            name: document.querySelector('.text-heading-xlarge, .pv-top-card--list li:first-child')?.textContent?.trim(),
            headline: document.querySelector('.text-body-medium, .pv-top-card--list-bullet li')?.textContent?.trim(),
            location: document.querySelector('.text-body-small.inline.t-black--light, .pv-top-card--list-bullet li:nth-child(2)')?.textContent?.trim(),
            about: document.querySelector('#about ~ .display-flex .inline-show-more-text, .pv-about-section .pv-about__summary-text')?.textContent?.trim()
        };

        profile.experience = Array.from(document.querySelectorAll('#experience ~ .pvs-list__outer-container > ul > li, .pv-experience-section .pv-entity__summary-info')).map(exp => ({
            title: exp.querySelector('.t-bold span, .pv-entity__summary-info h3')?.textContent?.trim(),
            company: exp.querySelector('.t-normal span, .pv-entity__secondary-title')?.textContent?.trim(),
            duration: exp.querySelector('.t-black--light span, .pv-entity__date-range span:nth-child(2)')?.textContent?.trim(),
            location: exp.querySelector('.t-black--light:nth-child(4) span')?.textContent?.trim(),
            description: exp.querySelector('.inline-show-more-text')?.textContent?.trim()
        }));

        profile.education = Array.from(document.querySelectorAll('#education ~ .pvs-list__outer-container > ul > li, .pv-education-section .pv-education-entity')).map(edu => ({
            school: edu.querySelector('.t-bold span, .pv-entity__school-name')?.textContent?.trim(),
            degree: edu.querySelector('.t-normal span, .pv-entity__degree-name .pv-entity__comma-item')?.textContent?.trim(),
            duration: edu.querySelector('.t-black--light span, .pv-entity__dates span:nth-child(2)')?.textContent?.trim(),
            description: edu.querySelector('.inline-show-more-text')?.textContent?.trim()
        }));

        profile.skills = Array.from(document.querySelectorAll('#skills ~ .pvs-list__outer-container > ul > li, .pv-skill-category-entity')).map(skill => ({
            name: skill.querySelector('.t-bold span, .pv-skill-category-entity__name span')?.textContent?.trim(),
            endorsements: skill.querySelector('.t-black--light span')?.textContent?.trim()
        }));

        if (include_recommendations) {
            profile.recommendations = Array.from(document.querySelectorAll('#recommendations ~ .pvs-list__outer-container > ul > li')).map(rec => ({
                text: rec.querySelector('.inline-show-more-text')?.textContent?.trim(),
                author: rec.querySelector('.t-bold span')?.textContent?.trim()
            }));
        }

        return { success: true, result: profile };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domGetLinkedInJob(args) {
    const { include_similar_jobs = false } = args || {};
    try {
        const job = {
            title: document.querySelector('.t-24.t-bold, .jobs-unified-top-card__job-title')?.textContent?.trim(),
            company: document.querySelector('.jobs-unified-top-card__company-name a, .jobs-unified-top-card__subtitle-primary-grouping a')?.textContent?.trim(),
            location: document.querySelector('.jobs-unified-top-card__bullet, .jobs-unified-top-card__subtitle-secondary-grouping span')?.textContent?.trim(),
            type: document.querySelector('.jobs-unified-top-card__workplace-type')?.textContent?.trim(),
            posted: document.querySelector('.jobs-unified-top-card__posted-date, .jobs-unified-top-card__subtitle-secondary-grouping span:last-child')?.textContent?.trim(),
            applicants: document.querySelector('.jobs-unified-top-card__applicant-count')?.textContent?.trim(),
            description: document.querySelector('.jobs-description__content, .jobs-box__html-content')?.textContent?.trim()
        };

        job.requirements = Array.from(document.querySelectorAll('.jobs-description__content li')).map(li => li.textContent?.trim());
        job.benefits = Array.from(document.querySelectorAll('.jobs-unified-top-card__job-insight span')).map(span => span.textContent?.trim()).filter(Boolean);

        if (include_similar_jobs) {
            job.similarJobs = Array.from(document.querySelectorAll('.jobs-similar-jobs__list li, .similar-jobs__list li')).map(item => ({
                title: item.querySelector('.job-card-list__title, a')?.textContent?.trim(),
                company: item.querySelector('.job-card-container__company-name, .artdeco-entity-lockup__subtitle')?.textContent?.trim(),
                location: item.querySelector('.job-card-container__metadata-item, .artdeco-entity-lockup__caption')?.textContent?.trim(),
                url: item.querySelector('a')?.href
            }));
        }

        return { success: true, result: job };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domGetLinkedInCompany(args) {
    const { include_jobs = false, job_limit = 5 } = args || {};
    try {
        const company = {
            name: document.querySelector('.org-top-card-summary__title, .top-card-layout__title')?.textContent?.trim(),
            industry: document.querySelector('.org-top-card-summary-info-list__info-item, .top-card-layout__first-subline')?.textContent?.trim(),
            size: document.querySelector('.org-about-company-module__company-size-definition-text')?.textContent?.trim(),
            headquarters: document.querySelector('.org-about-company-module__headquarters')?.textContent?.trim(),
            founded: document.querySelector('.org-about-company-module__founded')?.textContent?.trim(),
            description: document.querySelector('.org-about-us-organization-description__text, .org-top-card-summary__tagline')?.textContent?.trim(),
            website: document.querySelector('.org-about-us-company-module__website a, .link-without-visited-state')?.href,
            followers: document.querySelector('.org-top-card-summary-info-list__info-item:last-child')?.textContent?.trim(),
            specialties: Array.from(document.querySelectorAll('.org-about-company-module__speciality')).map(s => s.textContent?.trim())
        };

        if (include_jobs) {
            company.openJobs = Array.from(document.querySelectorAll('.org-jobs-job-search-form-module__job-card-list li, .jobs-search-results-list li'))
                .slice(0, job_limit).map(item => ({
                    title: item.querySelector('.job-card-list__title, a')?.textContent?.trim(),
                    location: item.querySelector('.job-card-container__metadata-item, .artdeco-entity-lockup__caption')?.textContent?.trim(),
                    listed: item.querySelector('.job-card-container__listed-time, time')?.textContent?.trim(),
                    url: item.querySelector('a')?.href
                }));
        }

        return { success: true, result: company };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ── Amazon Tools ──

export function domGetAmazonProduct(args) {
    const { include_reviews = false, review_limit = 5 } = args || {};
    try {
        const product = {
            title: document.querySelector('#productTitle')?.textContent?.trim(),
            brand: document.querySelector('#bylineInfo, .po-brand .a-span9')?.textContent?.trim(),
            price: {
                current: document.querySelector('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice')?.textContent?.trim(),
                original: document.querySelector('.a-price.a-text-price .a-offscreen, #priceblock_ourprice_lbl')?.textContent?.trim(),
                savings: document.querySelector('.savingsPercentage, #dealprice_savings')?.textContent?.trim()
            },
            rating: {
                stars: document.querySelector('#acrPopover .a-icon-alt, .a-star-4-5')?.textContent?.trim(),
                count: document.querySelector('#acrCustomerReviewText')?.textContent?.trim()
            },
            availability: document.querySelector('#availability span, #outOfStock span')?.textContent?.trim(),
            features: Array.from(document.querySelectorAll('#feature-bullets li span.a-list-item')).map(f => f.textContent?.trim()),
            description: document.querySelector('#productDescription p, #productDescription_feature_div')?.textContent?.trim(),
            specifications: Array.from(document.querySelectorAll('#productDetails_techSpec_section_1 tr, .a-keyvalue tr')).map(row => ({
                name: row.querySelector('th, td:first-child')?.textContent?.trim(),
                value: row.querySelector('td, td:last-child')?.textContent?.trim()
            })),
            images: Array.from(document.querySelectorAll('#altImages li img, .imgTagWrapper img')).map(img => img.src).filter(Boolean),
            url: window.location.href,
            asin: window.location.pathname.match(/\/dp\/([A-Z0-9]+)/)?.[1] || window.location.pathname.match(/\/product\/([A-Z0-9]+)/)?.[1]
        };

        if (include_reviews) {
            product.reviews = Array.from(document.querySelectorAll('#cm-cr-dp-review-list .review, [data-hook="review"]'))
                .slice(0, review_limit).map(review => ({
                    author: review.querySelector('.a-profile-name')?.textContent?.trim(),
                    rating: review.querySelector('.review-rating .a-icon-alt')?.textContent?.trim(),
                    title: review.querySelector('[data-hook="review-title"] span, .review-title')?.textContent?.trim(),
                    date: review.querySelector('[data-hook="review-date"], .review-date')?.textContent?.trim(),
                    verified: !!review.querySelector('[data-hook="avp-badge"]'),
                    text: review.querySelector('[data-hook="review-body"] span, .review-text')?.textContent?.trim(),
                    helpful: review.querySelector('[data-hook="helpful-vote-statement"]')?.textContent?.trim()
                }));
        }

        return { success: true, result: product };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ── YouTube Tools ──

export function domGetYouTubeVideo(args) {
    const { include_comments = false, comment_limit = 10 } = args || {};
    try {
        const video = {
            title: document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1')?.textContent?.trim(),
            channel: {
                name: document.querySelector('#channel-name yt-formatted-string a, ytd-channel-name a')?.textContent?.trim(),
                url: document.querySelector('#channel-name yt-formatted-string a, ytd-channel-name a')?.href,
                subscribers: document.querySelector('#owner-sub-count, yt-formatted-string#owner-sub-count')?.textContent?.trim()
            },
            views: document.querySelector('span.view-count, ytd-video-view-count-renderer span')?.textContent?.trim(),
            likes: document.querySelector('#segmented-like-button button, ytd-toggle-button-renderer #text')?.getAttribute('aria-label') ||
                   document.querySelector('#segmented-like-button button span, like-button-view-model button span')?.textContent?.trim(),
            uploadDate: document.querySelector('#info-strings yt-formatted-string, ytd-video-primary-info-renderer .date')?.textContent?.trim(),
            description: document.querySelector('#description-inline-expander yt-formatted-string, #description yt-formatted-string')?.textContent?.trim(),
            url: window.location.href,
            videoId: new URLSearchParams(window.location.search).get('v')
        };

        const tagElements = document.querySelectorAll('yt-formatted-string.super-title a');
        if (tagElements.length > 0) {
            video.tags = Array.from(tagElements).map(t => t.textContent?.trim());
        }

        const chapters = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
        if (chapters.length > 0) {
            video.chapters = Array.from(chapters).map(ch => ({
                title: ch.querySelector('#details h4')?.textContent?.trim(),
                timestamp: ch.querySelector('#time')?.textContent?.trim()
            }));
        }

        if (include_comments) {
            video.comments = Array.from(document.querySelectorAll('ytd-comment-thread-renderer'))
                .slice(0, comment_limit).map(c => ({
                    author: c.querySelector('#author-text span')?.textContent?.trim(),
                    content: c.querySelector('#content-text')?.textContent?.trim(),
                    likes: c.querySelector('#vote-count-middle')?.textContent?.trim(),
                    time: c.querySelector('.published-time-text a')?.textContent?.trim(),
                    isPinned: !!c.querySelector('#pinned-comment-badge'),
                    isHearted: !!c.querySelector('ytd-creator-heart-renderer')
                }));
        }

        return { success: true, result: video };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domGetYouTubePlaylist(args) {
    const { include_videos = false, video_limit = 10 } = args || {};
    try {
        const playlist = {
            title: document.querySelector('yt-formatted-string.ytd-playlist-header-renderer, h1.ytd-playlist-sidebar-primary-info-renderer')?.textContent?.trim(),
            creator: document.querySelector('#owner-text a, ytd-playlist-sidebar-primary-info-renderer yt-formatted-string a')?.textContent?.trim(),
            videoCount: document.querySelector('.metadata-stats yt-formatted-string, .byline-item')?.textContent?.trim(),
            visibility: document.querySelector('.badge-style-type-simple')?.textContent?.trim(),
            description: document.querySelector('.metadata-action-bar .yt-formatted-string, #description-text')?.textContent?.trim(),
            url: window.location.href
        };

        if (include_videos) {
            playlist.videos = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))
                .slice(0, video_limit).map(v => ({
                    title: v.querySelector('#video-title')?.textContent?.trim(),
                    url: v.querySelector('#video-title')?.href,
                    duration: v.querySelector('ytd-thumbnail-overlay-time-status-renderer span')?.textContent?.trim(),
                    channel: v.querySelector('.ytd-channel-name a')?.textContent?.trim(),
                    thumbnail: v.querySelector('img')?.src
                }));
        }

        return { success: true, result: playlist };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ── Reddit Tools ──

export function domGetRedditPost(args) {
    const { include_comments = false, comment_limit = 10 } = args || {};
    try {
        const post = {
            title: document.querySelector('h1, [data-testid="post-title"]')?.textContent?.trim(),
            author: document.querySelector('[data-testid="post_author_link"], .author')?.textContent?.trim(),
            score: document.querySelector('[data-testid="post-vote-count"], .score')?.textContent?.trim(),
            upvoteRatio: document.querySelector('.upvote-ratio')?.textContent?.trim(),
            content: document.querySelector('[data-testid="post-content"], .usertext-body .md')?.textContent?.trim() ||
                     document.querySelector('[data-testid="post-content"], .usertext-body .md')?.innerHTML?.trim(),
            subreddit: document.querySelector('[data-testid="subreddit-name"], .subreddit')?.textContent?.trim(),
            postTime: document.querySelector('[data-testid="post-timestamp"], time')?.textContent?.trim() ||
                      document.querySelector('[data-testid="post-timestamp"], time')?.getAttribute('datetime'),
            url: window.location.href,
            isLocked: !!document.querySelector('[data-testid="locked-icon"], .locked-icon'),
            isNSFW: !!document.querySelector('[data-testid="nsfw-badge"], .nsfw-stamp'),
            isSpoiler: !!document.querySelector('[data-testid="spoiler-badge"]')
        };

        if (include_comments) {
            post.comments = Array.from(document.querySelectorAll('.comment, [data-testid="comment"]'))
                .slice(0, comment_limit).map(c => ({
                    author: c.querySelector('.author, [data-testid="comment_author_link"]')?.textContent?.trim(),
                    content: c.querySelector('.usertext-body .md, [data-testid="comment"] p')?.textContent?.trim(),
                    score: c.querySelector('.score, [data-testid="comment-vote-count"]')?.textContent?.trim(),
                    timestamp: c.querySelector('time')?.textContent?.trim() || c.querySelector('time')?.getAttribute('datetime'),
                    isOp: !!c.querySelector('.submitter, [data-testid="op-badge"]'),
                    isStickied: !!c.querySelector('.stickied, [data-testid="stickied-badge"]')
                }));
        }

        return { success: true, result: post };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ── Stack Overflow Tools ──

export function domGetSOPageInfo() {
    try {
        const isQuestion = !!document.querySelector('#question');
        const isSearch = !!document.querySelector('.js-search-results, .search-results');
        const isTag = !!document.querySelector('.tag-page, [data-tag]');
        const isUser = !!document.querySelector('.user-page, #user-tab-content');

        if (isQuestion) {
            return {
                success: true,
                result: {
                    type: 'question',
                    data: {
                        title: document.querySelector('#question-header h1 a, .question-hyperlink')?.textContent?.trim(),
                        votes: document.querySelector('.js-vote-count, .vote-count-post')?.textContent?.trim(),
                        views: document.querySelector('.flex--item.ws-nowrap.mb8')?.textContent?.trim(),
                        tags: Array.from(document.querySelectorAll('.post-tag, .js-post-tag-list-item .post-tag')).map(t => t.textContent?.trim()),
                        answers: document.querySelector('#answers-header h2, .answers-subheader h2')?.textContent?.trim(),
                        url: window.location.href
                    }
                }
            };
        }

        if (isSearch) {
            return {
                success: true,
                result: {
                    type: 'search',
                    data: {
                        query: document.querySelector('.js-search-input, [name="q"]')?.value,
                        results: Array.from(document.querySelectorAll('.js-search-results .search-result, .search-results .result-link')).map(r => ({
                            title: r.querySelector('.result-link a, h3 a')?.textContent?.trim(),
                            url: r.querySelector('.result-link a, h3 a')?.href,
                            votes: r.querySelector('.vote-count-post, .stats .vote-count-post')?.textContent?.trim(),
                            excerpt: r.querySelector('.excerpt, .result-link + div')?.textContent?.trim()
                        }))
                    }
                }
            };
        }

        return {
            success: true,
            result: {
                type: 'home',
                data: {
                    questions: Array.from(document.querySelectorAll('.s-post-summary, .question-summary')).slice(0, 10).map(q => ({
                        title: q.querySelector('.s-post-summary--content-title a, .question-hyperlink')?.textContent?.trim(),
                        url: q.querySelector('.s-post-summary--content-title a, .question-hyperlink')?.href,
                        votes: q.querySelector('.s-post-summary--stats-item-number, .vote-count-post')?.textContent?.trim(),
                        tags: Array.from(q.querySelectorAll('.post-tag')).map(t => t.textContent?.trim())
                    }))
                }
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domGetSOAnswers(args) {
    const { sort_by = 'votes', include_comments = false } = args || {};
    try {
        let answers = Array.from(document.querySelectorAll('#answers .answer, .js-answer'));

        const answerData = answers.map(a => {
            const answer = {
                id: a.getAttribute('data-answerid'),
                votes: parseInt(a.querySelector('.js-vote-count')?.textContent?.trim() || '0'),
                isAccepted: a.classList.contains('accepted-answer') || !!a.querySelector('.js-accepted-answer-indicator'),
                content: a.querySelector('.js-post-body, .answercell .post-text')?.innerHTML?.trim(),
                author: {
                    name: a.querySelector('.user-details a, .post-signature .user-info a')?.textContent?.trim(),
                    profile: a.querySelector('.user-details a, .post-signature .user-info a')?.href,
                    reputation: a.querySelector('.reputation-score, .user-info .-flair span')?.textContent?.trim()
                },
                datePosted: a.querySelector('.user-action-time, .post-signature .relativetime')?.textContent?.trim()
            };

            if (include_comments) {
                answer.comments = Array.from(a.querySelectorAll('.comment, .js-comment')).map(c => ({
                    text: c.querySelector('.comment-copy, .comment-text .comment-copy')?.textContent?.trim(),
                    author: c.querySelector('.comment-user a')?.textContent?.trim(),
                    votes: c.querySelector('.comment-score span')?.textContent?.trim() || '0',
                    date: c.querySelector('.comment-date span, .relativetime-clean')?.textContent?.trim()
                }));
            }

            return answer;
        });

        if (sort_by === 'votes') answerData.sort((a, b) => b.votes - a.votes);
        else if (sort_by === 'newest') answerData.reverse();

        const accepted = document.querySelector('.accepted-answer, .js-accepted-answer-indicator')?.closest('.answer, .js-answer')?.getAttribute('data-answerid');

        return { success: true, result: { total: answerData.length, accepted, answers: answerData } };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domGetSORelatedQuestions(args) {
    const { include_hot_network_questions = false } = args || {};
    try {
        const result = {
            linked: Array.from(document.querySelectorAll('.linked .question-hyperlink, .sidebar-linked a')).map(a => ({
                title: a.textContent?.trim(),
                url: a.href,
                votes: a.closest('div')?.querySelector('.answer-votes, .vote-count-post')?.textContent?.trim()
            })),
            related: Array.from(document.querySelectorAll('.related .question-hyperlink, .sidebar-related a')).map(a => ({
                title: a.textContent?.trim(),
                url: a.href,
                votes: a.closest('div')?.querySelector('.answer-votes, .vote-count-post')?.textContent?.trim()
            }))
        };

        if (include_hot_network_questions) {
            result.hot_network = Array.from(document.querySelectorAll('#hot-network-questions li, .s-sidebarwidget--item')).map(item => ({
                title: item.querySelector('a')?.textContent?.trim(),
                url: item.querySelector('a')?.href,
                site: item.querySelector('.favicon, img')?.title || item.querySelector('.favicon, img')?.alt
            }));
        }

        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export function domGetSOQuestionDetails(args) {
    const { include_comments = false } = args || {};
    try {
        const questionEl = document.querySelector('#question, .question');
        if (!questionEl) {
            return { success: false, error: 'No question found on this page' };
        }

        const question = {
            id: questionEl.getAttribute('data-questionid'),
            title: document.querySelector('#question-header h1 a, .question-hyperlink')?.textContent?.trim(),
            content: questionEl.querySelector('.js-post-body, .post-text')?.innerHTML?.trim(),
            votes: questionEl.querySelector('.js-vote-count')?.textContent?.trim(),
            views: document.querySelector('.flex--item.ws-nowrap.mb8, .question-stats td:nth-child(2)')?.textContent?.trim(),
            tags: Array.from(document.querySelectorAll('.post-tag, .js-post-tag-list-item .post-tag')).map(t => t.textContent?.trim()),
            author: {
                name: questionEl.querySelector('.user-details a, .post-signature:last-child .user-info a')?.textContent?.trim(),
                profile: questionEl.querySelector('.user-details a, .post-signature:last-child .user-info a')?.href,
                reputation: questionEl.querySelector('.reputation-score, .post-signature:last-child .-flair span')?.textContent?.trim()
            },
            datePosted: questionEl.querySelector('.user-action-time, .post-signature .relativetime')?.textContent?.trim(),
            isEdited: !!questionEl.querySelector('.post-signature + .post-signature, .edited-timestamp'),
            bounty: {
                active: !!document.querySelector('.bounty-notification, .s-notice__bounty'),
                amount: document.querySelector('.bounty-notification .bounty-award, .s-notice__bounty .d-inline')?.textContent?.trim(),
                expires: document.querySelector('.bounty-notification .relativetime, .s-notice__bounty .relativetime')?.textContent?.trim()
            }
        };

        if (include_comments) {
            question.comments = Array.from(questionEl.querySelectorAll('.comment, .js-comment')).map(c => ({
                text: c.querySelector('.comment-copy, .comment-text .comment-copy')?.textContent?.trim(),
                author: c.querySelector('.comment-user a')?.textContent?.trim(),
                votes: c.querySelector('.comment-score span')?.textContent?.trim() || '0',
                date: c.querySelector('.comment-date span, .relativetime-clean')?.textContent?.trim()
            }));
        }

        return { success: true, result: question };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ── ColorPicker (extract mode only — pick mode needs user interaction) ──

export function domColorPickerExtract(args) {
    const { format = 'hex' } = args || {};
    try {
        const convertColor = (color, targetFormat) => {
            const div = document.createElement('div');
            div.style.color = color;
            document.body.appendChild(div);
            const computed = window.getComputedStyle(div).color;
            document.body.removeChild(div);
            const [r, g, b] = computed.match(/\d+/g).map(Number);
            switch (targetFormat) {
                case 'hex': return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
                case 'rgb': return `rgb(${r}, ${g}, ${b})`;
                case 'hsl': {
                    const rr = r / 255, gg = g / 255, bb = b / 255;
                    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
                    let h, s, l = (max + min) / 2;
                    if (max === min) { h = s = 0; }
                    else {
                        const d = max - min;
                        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                        switch (max) {
                            case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0); break;
                            case gg: h = (bb - rr) / d + 2; break;
                            case bb: h = (rr - gg) / d + 4; break;
                        }
                        h /= 6;
                    }
                    return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
                }
            }
        };

        const elements = document.querySelectorAll('*');
        const colors = new Set();
        elements.forEach(el => {
            const style = window.getComputedStyle(el);
            ['color', 'backgroundColor', 'borderColor'].forEach(prop => {
                const color = style[prop];
                if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
                    colors.add(color);
                }
            });
        });

        return {
            success: true,
            result: {
                colors: Array.from(colors).slice(0, 10).map(color => ({
                    [format]: convertColor(color, format),
                    original: color
                }))
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
