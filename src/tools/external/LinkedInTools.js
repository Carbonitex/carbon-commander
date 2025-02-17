class LinkedInTools {
    static name = "LinkedInTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('linkedin.com');
    }

    static GetProfileInfo = {
        function: {
            name: 'get_profile_info',
            description: 'Get detailed information about the current LinkedIn profile',
            parameters: {
                properties: {
                    include_recommendations: {
                        type: 'boolean',
                        description: 'Whether to include recommendations'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.pathname.includes('/in/')) {
                    return { success: false, error: 'Not on a LinkedIn profile page' };
                }

                const profileData = {
                    name: document.querySelector('h1.text-heading-xlarge')?.textContent?.trim(),
                    headline: document.querySelector('div.text-body-medium')?.textContent?.trim(),
                    location: document.querySelector('span.text-body-small')?.textContent?.trim(),
                    about: document.querySelector('div.inline-show-more-text')?.textContent?.trim(),
                    experience: Array.from(document.querySelectorAll('section.experience-section li'))
                        .map(exp => ({
                            title: exp.querySelector('h3')?.textContent?.trim(),
                            company: exp.querySelector('h4')?.textContent?.trim(),
                            duration: exp.querySelector('.date-range')?.textContent?.trim(),
                            location: exp.querySelector('.location')?.textContent?.trim(),
                            description: exp.querySelector('.show-more-less-text')?.textContent?.trim()
                        })),
                    education: Array.from(document.querySelectorAll('section.education-section li'))
                        .map(edu => ({
                            school: edu.querySelector('h3')?.textContent?.trim(),
                            degree: edu.querySelector('h4')?.textContent?.trim(),
                            duration: edu.querySelector('.date-range')?.textContent?.trim(),
                            description: edu.querySelector('.show-more-less-text')?.textContent?.trim()
                        })),
                    skills: Array.from(document.querySelectorAll('section.skills-section li'))
                        .map(skill => ({
                            name: skill.querySelector('.pill-text')?.textContent?.trim(),
                            endorsements: skill.querySelector('.endorsement-count')?.textContent?.trim()
                        }))
                };

                if (args.include_recommendations) {
                    profileData.recommendations = Array.from(document.querySelectorAll('section.recommendations-section li'))
                        .map(rec => ({
                            author: rec.querySelector('.recommendation-author')?.textContent?.trim(),
                            relationship: rec.querySelector('.recommendation-relationship')?.textContent?.trim(),
                            text: rec.querySelector('.recommendation-text')?.textContent?.trim(),
                            date: rec.querySelector('.recommendation-date')?.textContent?.trim()
                        }));
                }

                return { success: true, result: profileData };
            } catch (error) {
                scope.logError('Error getting LinkedIn profile info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetJobInfo = {
        function: {
            name: 'get_job_info',
            description: 'Get information about the current job posting',
            parameters: {
                properties: {
                    include_similar_jobs: {
                        type: 'boolean',
                        description: 'Whether to include similar job postings'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.pathname.includes('/jobs/view/')) {
                    return { success: false, error: 'Not on a LinkedIn job page' };
                }

                const jobData = {
                    title: document.querySelector('h1.job-title')?.textContent?.trim(),
                    company: document.querySelector('a.company-name')?.textContent?.trim(),
                    location: document.querySelector('span.job-location')?.textContent?.trim(),
                    type: document.querySelector('span.job-type')?.textContent?.trim(),
                    posted: document.querySelector('span.job-posted-date')?.textContent?.trim(),
                    applicants: document.querySelector('span.applicant-count')?.textContent?.trim(),
                    description: document.querySelector('div.job-description')?.textContent?.trim(),
                    requirements: Array.from(document.querySelectorAll('div.job-requirements li'))
                        .map(req => req.textContent?.trim()),
                    benefits: Array.from(document.querySelectorAll('div.job-benefits li'))
                        .map(benefit => benefit.textContent?.trim())
                };

                if (args.include_similar_jobs) {
                    jobData.similarJobs = Array.from(document.querySelectorAll('div.similar-jobs li'))
                        .map(job => ({
                            title: job.querySelector('.job-title')?.textContent?.trim(),
                            company: job.querySelector('.company-name')?.textContent?.trim(),
                            location: job.querySelector('.job-location')?.textContent?.trim(),
                            url: job.querySelector('a')?.href
                        }));
                }

                return { success: true, result: jobData };
            } catch (error) {
                scope.logError('Error getting LinkedIn job info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SearchJobs = {
        function: {
            name: 'search_jobs',
            description: 'Search LinkedIn jobs',
            parameters: {
                properties: {
                    keywords: {
                        type: 'string',
                        description: 'Job search keywords'
                    },
                    location: {
                        type: 'string',
                        description: 'Job location'
                    },
                    experience_level: {
                        type: 'string',
                        description: 'Experience level (internship, entry, associate, mid-senior, director, executive)'
                    },
                    job_type: {
                        type: 'string',
                        description: 'Job type (full-time, part-time, contract, temporary, volunteer, internship)'
                    },
                    remote: {
                        type: 'boolean',
                        description: 'Whether to show only remote jobs'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 10)'
                    }
                },
                required: ['keywords']
            }
        },
        execute: async function(scope, args) {
            try {
                let searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(args.keywords)}`;
                
                if (args.location) {
                    searchUrl += `&location=${encodeURIComponent(args.location)}`;
                }
                if (args.experience_level) {
                    searchUrl += `&f_E=${encodeURIComponent(args.experience_level)}`;
                }
                if (args.job_type) {
                    searchUrl += `&f_JT=${encodeURIComponent(args.job_type)}`;
                }
                if (args.remote) {
                    searchUrl += '&f_WT=2';
                }

                const response = await scope.$http.get(searchUrl);
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.data, 'text/html');

                const limit = args.limit || 10;
                const jobs = Array.from(doc.querySelectorAll('.job-card-container'))
                    .slice(0, limit)
                    .map(job => ({
                        title: job.querySelector('.job-card-list__title')?.textContent?.trim(),
                        company: job.querySelector('.job-card-container__company-name')?.textContent?.trim(),
                        location: job.querySelector('.job-card-container__metadata-item')?.textContent?.trim(),
                        listed: job.querySelector('.job-card-container__listed-time')?.textContent?.trim(),
                        url: job.querySelector('a')?.href,
                        description: job.querySelector('.job-card-list__description')?.textContent?.trim()
                    }));

                return { success: true, result: jobs };
            } catch (error) {
                scope.logError('Error searching LinkedIn jobs:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetCompanyInfo = {
        function: {
            name: 'get_company_info',
            description: 'Get information about the current company page',
            parameters: {
                properties: {
                    include_jobs: {
                        type: 'boolean',
                        description: 'Whether to include open jobs'
                    },
                    job_limit: {
                        type: 'number',
                        description: 'Maximum number of jobs to return (default: 5)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.pathname.includes('/company/')) {
                    return { success: false, error: 'Not on a LinkedIn company page' };
                }

                const companyData = {
                    name: document.querySelector('h1.org-top-card-summary__title')?.textContent?.trim(),
                    industry: document.querySelector('.org-top-card-summary__industry')?.textContent?.trim(),
                    size: document.querySelector('.org-about-company-module__company-size-definition-text')?.textContent?.trim(),
                    headquarters: document.querySelector('.org-about-company-module__headquarters')?.textContent?.trim(),
                    founded: document.querySelector('.org-about-company-module__founded')?.textContent?.trim(),
                    description: document.querySelector('.org-about-us-organization-description__text')?.textContent?.trim(),
                    website: document.querySelector('.org-about-company-module__website')?.href,
                    followers: document.querySelector('.org-top-card-summary__follower-count')?.textContent?.trim(),
                    specialties: Array.from(document.querySelectorAll('.org-about-company-module__specialties li'))
                        .map(specialty => specialty.textContent?.trim())
                };

                if (args.include_jobs) {
                    const jobLimit = args.job_limit || 5;
                    companyData.openJobs = Array.from(document.querySelectorAll('.org-jobs-job-card'))
                        .slice(0, jobLimit)
                        .map(job => ({
                            title: job.querySelector('.job-card-list__title')?.textContent?.trim(),
                            location: job.querySelector('.job-card-container__metadata-item')?.textContent?.trim(),
                            listed: job.querySelector('.job-card-container__listed-time')?.textContent?.trim(),
                            url: job.querySelector('a')?.href
                        }));
                }

                return { success: true, result: companyData };
            } catch (error) {
                scope.logError('Error getting LinkedIn company info:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['LinkedInTools'] = LinkedInTools;
} else {
    window.sbaiTools = {
        'LinkedInTools': LinkedInTools
    };
}

export { LinkedInTools }; 