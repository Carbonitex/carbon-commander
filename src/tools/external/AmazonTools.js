class AmazonTools {
    static name = "AmazonTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('amazon.com');
    }

    static GetProductInfo = {
        function: {
            name: 'get_product_info',
            description: 'Get detailed information about the current product',
            parameters: {
                properties: {
                    include_reviews: {
                        type: 'boolean',
                        description: 'Whether to include top reviews'
                    },
                    review_limit: {
                        type: 'number',
                        description: 'Maximum number of reviews to return (default: 5)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.pathname.includes('/dp/')) {
                    return { success: false, error: 'Not on a product page' };
                }

                const productData = {
                    title: document.querySelector('#productTitle')?.textContent?.trim(),
                    brand: document.querySelector('#bylineInfo')?.textContent?.trim(),
                    price: {
                        current: document.querySelector('#priceblock_ourprice, #priceblock_dealprice')?.textContent?.trim(),
                        original: document.querySelector('#priceblock_listprice')?.textContent?.trim(),
                        savings: document.querySelector('#regularprice_savings')?.textContent?.trim()
                    },
                    rating: {
                        stars: document.querySelector('#acrPopover')?.title?.trim(),
                        count: document.querySelector('#acrCustomerReviewText')?.textContent?.trim()
                    },
                    availability: document.querySelector('#availability')?.textContent?.trim(),
                    features: Array.from(document.querySelectorAll('#feature-bullets li'))
                        .map(feature => feature.textContent?.trim()),
                    description: document.querySelector('#productDescription')?.textContent?.trim(),
                    specifications: Array.from(document.querySelectorAll('#productDetails_techSpec_section_1 tr'))
                        .map(spec => ({
                            name: spec.querySelector('th')?.textContent?.trim(),
                            value: spec.querySelector('td')?.textContent?.trim()
                        })),
                    images: Array.from(document.querySelectorAll('#altImages img'))
                        .map(img => img.src),
                    url: window.location.href,
                    asin: window.location.pathname.match(/\/dp\/([A-Z0-9]+)/)?.[1]
                };

                if (args.include_reviews) {
                    const reviewLimit = args.review_limit || 5;
                    productData.reviews = Array.from(document.querySelectorAll('#cm-cr-dp-review-list div.review'))
                        .slice(0, reviewLimit)
                        .map(review => ({
                            author: review.querySelector('.a-profile-name')?.textContent?.trim(),
                            rating: review.querySelector('.review-rating')?.textContent?.trim(),
                            title: review.querySelector('.review-title')?.textContent?.trim(),
                            date: review.querySelector('.review-date')?.textContent?.trim(),
                            verified: !!review.querySelector('.avp-badge'),
                            text: review.querySelector('.review-text')?.textContent?.trim(),
                            helpful: review.querySelector('.cr-vote-text')?.textContent?.trim()
                        }));
                }

                return { success: true, result: productData };
            } catch (error) {
                scope.logError('Error getting product info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SearchProducts = {
        function: {
            name: 'search_products',
            description: 'Search Amazon products',
            parameters: {
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    },
                    department: {
                        type: 'string',
                        description: 'Department to search in'
                    },
                    min_rating: {
                        type: 'number',
                        description: 'Minimum star rating (1-5)'
                    },
                    prime_only: {
                        type: 'boolean',
                        description: 'Show only Prime-eligible items'
                    },
                    sort_by: {
                        type: 'string',
                        description: 'Sort results by (featured, price-asc, price-desc, rating)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 10)'
                    }
                },
                required: ['query']
            }
        },
        execute: async function(scope, args) {
            try {
                let searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(args.query)}`;
                
                if (args.department) {
                    searchUrl += `&i=${encodeURIComponent(args.department)}`;
                }
                if (args.min_rating) {
                    searchUrl += `&rh=p_72:${Math.round(args.min_rating * 100)}`;
                }
                if (args.prime_only) {
                    searchUrl += '&rh=p_85:2470955011';
                }
                if (args.sort_by) {
                    searchUrl += `&s=${encodeURIComponent(args.sort_by)}`;
                }

                const response = await scope.$http.get(searchUrl);
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.data, 'text/html');

                const limit = args.limit || 10;
                const results = Array.from(doc.querySelectorAll('div[data-component-type="s-search-result"]'))
                    .slice(0, limit)
                    .map(result => ({
                        title: result.querySelector('h2')?.textContent?.trim(),
                        url: 'https://www.amazon.com' + result.querySelector('h2 a')?.getAttribute('href'),
                        image: result.querySelector('img.s-image')?.src,
                        price: {
                            current: result.querySelector('.a-price .a-offscreen')?.textContent?.trim(),
                            original: result.querySelector('.a-price[data-a-strike="true"] .a-offscreen')?.textContent?.trim()
                        },
                        rating: {
                            stars: result.querySelector('.a-icon-star-small')?.textContent?.trim(),
                            count: result.querySelector('.a-size-base.s-underline-text')?.textContent?.trim()
                        },
                        prime: !!result.querySelector('.s-prime'),
                        sponsored: !!result.querySelector('.s-sponsored-label-info-icon'),
                        asin: result.getAttribute('data-asin')
                    }));

                return { success: true, result: results };
            } catch (error) {
                scope.logError('Error searching Amazon products:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetPriceHistory = {
        function: {
            name: 'get_price_history',
            description: 'Get price history for the current product',
            parameters: {
                properties: {
                    asin: {
                        type: 'string',
                        description: 'Product ASIN (if not on product page)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const asin = args.asin || window.location.pathname.match(/\/dp\/([A-Z0-9]+)/)?.[1];
                if (!asin) {
                    return { success: false, error: 'No ASIN provided or found' };
                }

                // Use CamelCamelCamel API for price history
                const response = await scope.$http.get(`https://api.camelcamelcamel.com/products/${asin}`);
                const priceHistory = response.data;

                return {
                    success: true,
                    result: {
                        current_price: priceHistory.current_price,
                        highest_price: priceHistory.highest_price,
                        lowest_price: priceHistory.lowest_price,
                        price_drops: priceHistory.price_drops.map(drop => ({
                            date: new Date(drop.date).toISOString(),
                            price: drop.price,
                            type: drop.type
                        })),
                        price_history: priceHistory.price_history.map(point => ({
                            date: new Date(point.date).toISOString(),
                            price: point.price
                        }))
                    }
                };
            } catch (error) {
                scope.logError('Error getting price history:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetSellerInfo = {
        function: {
            name: 'get_seller_info',
            description: 'Get information about a product seller',
            parameters: {
                properties: {
                    include_feedback: {
                        type: 'boolean',
                        description: 'Whether to include seller feedback'
                    },
                    feedback_limit: {
                        type: 'number',
                        description: 'Maximum number of feedback entries to return (default: 5)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const sellerLink = document.querySelector('#sellerProfileTriggerId');
                if (!sellerLink) {
                    return { success: false, error: 'Seller information not found' };
                }

                const sellerId = sellerLink.getAttribute('href').match(/seller=([A-Z0-9]+)/)?.[1];
                const response = await scope.$http.get(`https://www.amazon.com/sp?seller=${sellerId}`);
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.data, 'text/html');

                const sellerData = {
                    name: doc.querySelector('#sellerName')?.textContent?.trim(),
                    rating: doc.querySelector('#seller-rating')?.textContent?.trim(),
                    positive_feedback: doc.querySelector('#positive-feedback-percentage')?.textContent?.trim(),
                    feedback_count: doc.querySelector('#feedback-count')?.textContent?.trim(),
                    business_location: doc.querySelector('#seller-business-location')?.textContent?.trim(),
                    business_type: doc.querySelector('#seller-business-type')?.textContent?.trim(),
                    metrics: {
                        shipping: doc.querySelector('#shipping-metrics')?.textContent?.trim(),
                        customer_service: doc.querySelector('#customer-service-metrics')?.textContent?.trim(),
                        product_quality: doc.querySelector('#product-quality-metrics')?.textContent?.trim()
                    }
                };

                if (args.include_feedback) {
                    const feedbackLimit = args.feedback_limit || 5;
                    sellerData.feedback = Array.from(doc.querySelectorAll('#feedback-table tr'))
                        .slice(1, feedbackLimit + 1) // Skip header row
                        .map(feedback => ({
                            rating: feedback.querySelector('.feedback-rating')?.textContent?.trim(),
                            comment: feedback.querySelector('.feedback-comment')?.textContent?.trim(),
                            product: feedback.querySelector('.feedback-product')?.textContent?.trim(),
                            date: feedback.querySelector('.feedback-date')?.textContent?.trim(),
                            reviewer: feedback.querySelector('.feedback-reviewer')?.textContent?.trim()
                        }));
                }

                return { success: true, result: sellerData };
            } catch (error) {
                scope.logError('Error getting seller info:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['AmazonTools'] = AmazonTools;
} else {
    window.sbaiTools = {
        'AmazonTools': AmazonTools
    };
}

export { AmazonTools }; 