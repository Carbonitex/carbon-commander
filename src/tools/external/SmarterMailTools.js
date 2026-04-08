import { TOOL_CONTEXT } from '../../global.js';

//TODO: Reduce size of SM content returns
//TODO: Tool for marking folders as read

class SmarterMailTools {
    static name = "SmarterMailTools";

    static _CarbonBarPageLoadFilter = (window) => {
        try{
            const user = angular.element(document).injector().get('coreData').user;
            if(user.username != null && user.username != '') {
                //If system admin, don't allow tools to be called they have a seperate list of tools
                if(user.isSysAdmin) {
                    return false;
                }
                //smartermail user logged in
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    static _matchesUrl = (url) => false;

    static _CarbonBarBuildScope = async (scope) => {
        scope.getService = (serviceName) => {
            return angular.element(document).injector().get(serviceName);
        }
        scope.$http = scope.getService('$http');
        scope.$rootScope = window.smRsHook.$root;
        scope.getUserInfo = () => 
        {
            return new Promise(async (resolve, reject) => {
              try {
                const userService = await scope.getService('userDataService');
                const timeService = await scope.getService('userTimeService');
                
                resolve({
                  displayName: userService.user.displayName,
                  username: userService.user.username,
                  emailAddress: userService.user.emailAddress,
                  locale: userService.user.settings.userMailSettings.localeId,
                  categories: userService.user.categories,
                  tzid: timeService.userTimeZone.id
                });
              } catch (error) {
                reject(error);
              }
            });
        }

        try{
            var userInfo = await scope.getUserInfo();
            scope.appName = `SmarterMail [${userInfo.emailAddress}]`;
        } catch (error) {
            scope.logError('Error building scope', error);
            scope.appName = 'SmarterMail [Unknown User]';
        }

        return scope;
    }

    static _CarbonBarSystemPrompt = async (basePrompt, scope) => {
        var systemPrompt = basePrompt + '\n';
        try {
            var userInfo = await scope.getUserInfo();
            //include the user info
            systemPrompt += `The user is "${userInfo.displayName}" with email "${userInfo.emailAddress}" and timezone "${userInfo.tzid}" and locale "${userInfo.locale}"`;
    
            //include the categories
            if (userInfo.categories) {
              systemPrompt += `. User categories: ${userInfo.categories.map(category => category.name).join(', ')}`;
            }

            try {
                const coreMailService = scope.getService('coreDataMail');
                await coreMailService.loadMailTree();
                const folderList = await coreMailService.getFolderList();

                //only print the top level folders
                const topLevelFolders = folderList.filter(folder => folder.parentFolder == '');
                
                const folderNameBuilder = (folder) => {
                    if(folder.parentFolder == '') {
                        const sfStr = topLevelFolders.filter(f => f.parentFolder == folder.id).length > 0 ? ` (${topLevelFolders.filter(f => f.parentFolder == folder.id).length} subfolders)` : '';
                        return `${folder.name}${sfStr}`;
                    }
                    return folder.name;
                }

                systemPrompt += `. User folders: ${topLevelFolders.map(folderNameBuilder).join(', ')}`;
            } catch (error) {
                scope.logError('Error getting folder list:', error);
            }

          } catch (error) {
            scope.logError('Error getting user info:', error);
            systemPrompt += '. Unable to get user info.';
          }

        return systemPrompt;
    }

    static GetHelp = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_help',
            description: 'User is asking for help with something',
            parameters: {
                properties: {
                    topic: {
                        type: 'string'
                    },
                    command: {
                        type: 'string'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            scope.logMessage(`GetHelp: ${JSON.stringify(args, null, 2)}`);
            const { topic, command } = args;
            const result = await scope.$http.get(`https://api.openai.com/v1/chat/completions`, {
                headers: {
                    'Authorization': `Bearer ${scope.apiKey}`
                }
            });
            scope.logMessage(`GetHelp result: ${JSON.stringify(result, null, 2)}`);
            var response = result.data.choices[0].message.content;
            return { success: true, result: response };
        }
    };

    
    static GetCategoriesAndOtherFolders = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_categories_and_other_folders',
            description: "Get user's categories and folders for non-email sources",
        },
        execute: async function(scope, args) {
            const catService = scope.getService('coreDataCategories');
            const coreDataCalendar = scope.getService('coreDataCalendar');
            const coreDataNotes = scope.getService('coreDataNotes');
            const coreDataTasks = scope.getService('coreDataTasks');
            const coreDataContacts = scope.getService('coreDataContacts');
            await catService.loadUsersCategories();           
            const categories = await catService.getUsersCategories();
            //const folderList = await coreMailService.getFolderList();
            var folderList = [];

            coreDataCalendar.loadSources().then(function () {
                var calendars = coreDataCalendar.getCalendars();
                var calItems = [];
                for (var i = 0; i < calendars.length; i++) {
                    if (calendars[i].isSharedItem)
                        continue;
                    calItems.push({ translation: calendars[i].untranslatedName ? $translate.instant(calendars[i].untranslatedName) : calendars[i].name, value: calendars[i].id });
                }
                folderList['calendar'] = calItems;
            });
            coreDataNotes.ensureSourcesLoadedPromise().then(function () {
                var notes = coreDataNotes.getSources();
                notes = notes.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['notes'] = notes;
            });

            coreDataTasks.ensureSourcesLoadedPromise().then(function () {
                var tasks = coreDataTasks.getSources();
                tasks = tasks.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['tasks'] = tasks;
            });

            coreDataContacts.ensureSourcesLoadedPromise().then(function () {
                $scope.contactFolders = coreDataContacts.getSources();
                var contacts = coreDataContacts.getSources();
                contacts = contacts.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['contacts'] = contacts;
            });
            
            return { success: true, result: { categories, folderList } };
        }
    };

    static UpdateCategory = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'update_category',
            description: "Update or create a category for the user's account.",
            parameters: {
                properties: {
                    guid: {
                        type: 'string',
                        description: 'The guid of the category to update (only for updating)'
                    },
                    name: {
                        type: 'string'
                    },
                    color_index: {
                        type: 'number',
                        description: 'The color index (-1 = none/default, 0 = red, 1 = orange, 3 = yellow, 4 = green, 7 = blue, 8 = purple)'
                    },
                    is_default: {
                        type: 'boolean',
                        description: 'Whether this category is the default category'
                    }
                },
                required: ['name']
            }
        },
        execute: async function(scope, args) {
            const { guid, name, color_index, is_default } = args;
            var catResult = await scope.$http.get("~/api/v1/categories/user-category-settings");
            var catSettings = catResult.categorySettings;

            if(is_default) {
                catSettings.defaultCategory = name;
            }

            if(guid) {
                catSettings.categories = catSettings.categories.filter(cat => cat.guid !== guid);
            }
            catSettings.categories.push({ guid, name, colorIndex: color_index });
            try {
                await scope.$http.post("~/api/v1/categories/user-category-settings", catSettings);
                return { success: true, result: "Categories set" };
            } catch (error) {
                scope.logError('Error setting categories:', error);
                return { success: false, error: error.message };
            }
        }
    };

    //TODO: Newsfeeds?
    //TODO: basic user settings, contents filters, etc

    //TODO: (later) domain and system admin tools 
    //TODO: force user verification based on tool property



    static GetEmailFolders = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_email_folders',
            description: "Get folders for the user's emails"
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');
            const folderList = await coreMailService.getFolderList();
            return { success: true, result: folderList };
        }
    };

    static RemoveFolders = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'remove_folders',
            description: 'Remove folders for the user.',
            parameters: {
                properties: {
                    folder_ids: {
                        type: 'string',
                        description: "The id's of the folders to remove. Child folders are also removed. (comma separated)"
                    }
                },
                required: ['folder_ids']
            }
        },
        execute: async function(scope, args) {
            let folderIds = args.folder_ids.split(',').map(f => f.trim());
            const coreMailService = scope.getService('coreDataMail');
            await coreMailService.loadMailTree();

            const tasksService = scope.getService('coreDataTasks');
            await tasksService.ensureSourcesLoadedPromise();

            const notesService = scope.getService('coreDataNotes');
            await notesService.ensureSourcesLoadedPromise();

            const contactService = scope.getService('coreDataContacts');
            await contactService.ensureSourcesLoadedPromise();

            const calendarService = scope.getService('coreDataCalendar');
            await calendarService.loadSources();

            let totalRemovedFolders = 0;
            let removedFolders = [];
            let aiOutput = '';

            for(var i = 0; i < folderIds.length; i++) {
                //email folders
                const emailFolders = await coreMailService.getFolderList();
                var emailFolder = null;
                for(var j = 0; j < emailFolders.length; j++) { 
                    scope.logMessage(`Checking email folder: ${emailFolders[j].name} (${emailFolders[j].id})`, `Match: ${emailFolders[j].id} == ${folderIds[i]}`);
                    if(emailFolders[j].id == folderIds[i]) {
                        emailFolder = emailFolders[j];
                        break;
                    }
                }
                if(emailFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/folders/delete-folder', { 
                            folder: emailFolder.path,
                            parentFolder: ""
                        });
                        scope.logMessage('RemoveEmailFolder result:', result);
                        if(result.data.success) {
                            removedFolders.push({name: emailFolder.name, id: emailFolder.id});
                        } else {
                            aiOutput += `Error removing email folder: ${folderIds[i]} - ${result.data.message}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing email folder:', error);
                        aiOutput += `Error removing email folder: ${folderIds[i]} - ${error.data?.message}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed email folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const taskFolders = await tasksService.getSources();
                var taskFolder = null;
                for(var j = 0; j < taskFolders.length; j++) { 
                    scope.logMessage(`Checking task folder: ${taskFolders[j].name} (${taskFolders[j].folderId})`, `Match: ${taskFolders[j].folderId} == ${folderIds[i]}`);
                    if(taskFolders[j].folderId == folderIds[i]) {
                        taskFolder = taskFolders[j];
                        break;
                    }
                }
                if(taskFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/tasks/sources/delete', { 
                            folder: taskFolder.name,
                            uid: taskFolder.id
                        });
                        scope.logMessage('RemoveTaskFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: taskFolder.name, id: taskFolder.id});
                        } else {
                            aiOutput += `Error removing task folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing task folder:', error);
                        aiOutput += `Error removing task folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed task folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const noteFolders = await notesService.getSources();
                var noteFolder = null;
                for(var j = 0; j < noteFolders.length; j++) { 
                    scope.logMessage(`Checking note folder: ${noteFolders[j].displayName} (${noteFolders[j].folderId})`, `Match: ${noteFolders[j].folderId} == ${folderIds[i]}`);
                    if(noteFolders[j].folderId == folderIds[i]) {
                        noteFolder = noteFolders[j];
                        break;
                    }
                }
                if(noteFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/notes/sources/delete', { 
                            uid: noteFolder.itemID,
                            folder: noteFolder.displayName
                        });
                        scope.logMessage('RemoveNoteFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: noteFolder.displayName, id: noteFolder.itemID});
                        } else {
                            aiOutput += `Error removing note folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing note folder:', error);
                        aiOutput += `Error removing note folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed note folders: ${removedFolders.map(rf => rf.displayName).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const contactFolders = await contactService.getSources();
                var contactFolder = null;
                for(var j = 0; j < contactFolders.length; j++) { 
                    scope.logMessage(`Checking contact folder: ${contactFolders[j].displayName} (${contactFolders[j].folderId})`, `Match: ${contactFolders[j].folderId} == ${folderIds[i]}`);
                    if(contactFolders[j].folderId == folderIds[i]) {
                        contactFolder = contactFolders[j];
                        break;
                    }
                }
                if(contactFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/contacts/address-book/delete', { 
                            uid: contactFolder.itemID,
                            //folder: contactFolder.displayName //not needed
                        });
                        scope.logMessage('RemoveContactFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: contactFolder.displayName, id: contactFolder.itemID});
                        } else {
                            aiOutput += `Error removing contact folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing contact folder:', error);
                        aiOutput += `Error removing contact folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed contact folders: ${removedFolders.map(rf => rf.displayName).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }


            for(var i = 0; i < folderIds.length; i++) {
                const calendarFolders = await calendarService.getCalendars();
                var calendarFolder = null;
                for(var j = 0; j < calendarFolders.length; j++) { 
                    scope.logMessage(`Checking calendar folder: ${calendarFolders[j].name} (${calendarFolders[j].folderId})`, `Match: ${calendarFolders[j].folderId} == ${folderIds[i]}`);
                    if(calendarFolders[j].folderId == folderIds[i]) {
                        calendarFolder = calendarFolders[j];
                        break;
                    }
                }
                if(calendarFolder) {
                    try {
                        var result = await scope.$http.post(`~/api/v1/calendars/calendar-delete/${calendarFolder.id}`);
                        scope.logMessage('RemoveCalendarFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: calendarFolder.name, id: calendarFolder.id});
                        } else {
                            aiOutput += `Error removing calendar folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing calendar folder:', error);
                        aiOutput += `Error removing calendar folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed calendar folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];    
            }

            if(totalRemovedFolders > 0) {
                return { success: true, result: aiOutput };
            } else {
                aiOutput += "\nNo folders removed";
                return { success: false, error: aiOutput };
            }
        }
    };

    static UpdateFolder = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'update_folder',
            description: 'Update or create a folder for the user.',
            parameters: {
                properties: {
                    type: {
                        type: 'string',
                        description: 'The type of the folder to update (email, calendar, notes, tasks, contacts)'
                    },
                    name: {
                        type: 'string',
                        description: 'The name of the folder to update'
                    },
                    parent_folder_id: {
                        type: 'string',
                        description: 'The parent folder_id to nest the folder in (optional, only for email)'
                    },
                    folder_id: {
                        type: 'string',
                        description: 'The id of the folder to update (only for updating)'
                    },
                    color: {
                        type: 'string',
                        description: 'The hex color of the calendar to update (only for calendars and tasks)'
                    }
                },
                required: ['type', 'name']
            }
        },
        execute: async function(scope, args) {
            const { type, name, parent_folder_id, folder_id, color } = args;

            if(type == 'email') {
                const coreMailService = scope.getService('coreDataMail');
                await coreMailService.loadMailTree();
                const folderList = await coreMailService.getFolderList();
                if(folder_id) {
                    //update in place
                    var folder = folderList.find(f => f.id == folder_id);
                    var parentFolder = parent_folder_id ? folderList.find(f => f.id == parent_folder_id) : null;
                    
                    if(parent_folder_id && !parentFolder) {
                        scope.logMessage(`Parent folder not found: ${parent_folder_id}`, folderList.map(f => `(${f.id} - ${f.path})`));
                        return { success: false, error: `Parent folder not found: ${parent_folder_id}, folderList: ${folderList.map(f => ` (${f.id} - ${f.path})`)}` };
                    }

                    if(folder) {
                        //This uses the folder names so we need to get the folders by id first
                        try {
                            var result = await scope.$http.post("~/api/v1/folders/folder-put", {
                                folder: name,
                                parentFolder: parentFolder?.path,
                                //ownerEmailAddress: ""
                            });
                            return { success: true, result: result.data };
                        } catch (error) {
                            scope.logError('Error updating folder:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Folder to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    var parentFolder = parent_folder_id ? folderList.find(f => f.id == parent_folder_id) : null;
                    try {
                        var result = await scope.$http.post("~/api/v1/folders/folder-put", {
                            folder: name,
                            parentFolder: parentFolder?.path,
                        });
                        return { success: true, result: result.data };
                    } catch (error) {
                        scope.logError('Error creating folder:', error);
                        return { success: false, error: error.message };
                    }
                }

            } else if(type == 'calendar') {
                var calendarService = scope.getService('coreDataCalendar');
                await calendarService.loadSources();
                var calendars = await calendarService.getCalendars();

                if(folder_id) {
                    var calendar = calendars.find(c => c.folderId == folder_id);
                    if(calendar) {
                        try {
                            let request = await scope.$http.post('~/api/v1/calendars/calendar', {
                                setting: {
                                    id: calendar.id,
                                    friendlyName: name || calendar.friendlyName,
                                    calendarViewColor: color || calendar.calendarViewColor,
                                    isPrimary: calendar.isPrimary
                                }
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                if(request.data)
                                    request.data.success = false; //Fixes an issue with calendar api
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            if(error.data)
                                error.data.success = false; //Fixes an issue with calendar api
                            scope.logError('Error updating calendar:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Calendar to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/calendars/calendar-put', {
                            setting: {
                                friendlyName: name,
                                calendarViewColor: color || "#7FC56F",
                                isPrimary: false
                            }
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            if(request.data)
                                request.data.success = false; //Fixes an issue with calendar api
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        if(error.data)
                            error.data.success = false; //Fixes an issue with calendar api
                        scope.logError('Error adding calendar:', error);
                        return { success: false, error: error.data };
                    }
                }
                
            } else if(type == 'notes') {
                var notesService = scope.getService('coreDataNotes');
                await notesService.ensureSourcesLoadedPromise();
                var noteFolders = await notesService.getSources();

                if(folder_id) {
                    var noteFolder = noteFolders.find(n => n.folderId == folder_id);
                    if(noteFolder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/notes/sources/edit', {
                                folder: name,
                                uid: noteFolder.itemID
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating note:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Note to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/notes/sources/add', {
                            folder: name
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding note:', error);
                        return { success: false, error: error.data };
                    }
                }

            } else if(type == 'tasks') {

                var tasksService = scope.getService('coreDataTasks');
                await tasksService.ensureSourcesLoadedPromise();
                var taskFolders = await tasksService.getSources();

                if(folder_id) {
                    var taskFolder = taskFolders.find(t => t.folderId == folder_id);
                    if(taskFolder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/tasks/sources/edit', {
                                folder: name,
                                uid: taskFolder.id,
                                color: color || "#7FC56F"
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating task:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Task to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/tasks/sources/add', {
                            folder: name,
                            color: color || "#7FC56F"
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding task:', error);
                        return { success: false, error: error.data };
                    }
                }
                
            } else if(type == 'contacts') {
                var contactService = scope.getService('coreDataContacts');
                var contactFolders = await contactService.getSources();
                
                if(folder_id) {
                    var folder = contactFolders.find(f => f.folderId == folder_id);
                    if(folder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/contacts/address-book/edit', {
                                folder: name,
                                uid: folder.itemID,
                                //ownerEmailAddress: ""
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating folder:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Folder to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/contacts/address-book/add', {
                            folder: name,
                            //ownerEmailAddress: ""
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding folder:', error);
                        return { success: false, error: error.data };
                    }
                }
            }
            
            return { success: false, error: `Folder type not supported: ${type}, supported types are: email, calendar, notes, tasks, contacts` };
        }
    }




    static ReadEmailsFast = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'read_emails_fast',
            description: 'Read emails from a folder quickly with minimal content and metadata',
            parameters: {
                properties: {
                    message_filter: {
                        type: 'number',
                        description: '0 = most recent, 1 = unread, 2 = flagged, 3 = calendar, 4 = replied, -1 = all'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to read emails from (default = inbox)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from'
                    }
                },
                required: ['message_filter']
            }
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');
            const folder = args.folder?.toLowerCase() || 'inbox';
            const maxResults = args.max_results || 10;
            const startIndex = args.startIndex || 0;

            let searchCriteria = {
                folder: folder,
                ownerEmailAddress: '',
                sortType: 5, // internalDate
                sortAscending: false,
                startIndex: startIndex,
                maxResults: maxResults
            };

            // Add filter based on message_filter parameter
            if (args.message_filter !== -1) {
                searchCriteria.searchFlags = {};
                switch(args.message_filter) {
                    case 0: // most recent - no additional flags needed
                        break;
                    case 1: // unread
                        searchCriteria.searchFlags[0] = false; 
                        break;
                    case 2: // flagged
                        searchCriteria.searchFlags[4] = true;
                        break;
                    case 3: // calendar
                        searchCriteria.searchFlags[8] = true;
                        break;
                    case 4: // replied
                        searchCriteria.searchFlags[1] = true;
                        break;
                }
            }

            try {
                const result = await scope.$http.post("~/api/v1/mail/messages", searchCriteria);
                return { success: true, result: result.data };
            } catch (error) {
                scope.logError('Error fetching emails:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadEmail = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'read_email',
            description: 'Get the full email data for a given email by folder and uid',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: 'The uid of the email to read'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to read emails from (default = inbox)'
                    },
                    include_attachments: {
                        type: 'boolean',
                        description: 'Whether to include attachment details (default: false)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const parameters = {
                    'Folder': args.folder || 'inbox',
                    'UID': args.uid,
                    'OwnerEmailAddress': ""
                };

                // Get the full message data
                const messageResponse = await scope.$http.post("~/api/v1/mail/message", parameters);
                
                // If attachments are requested, get them
                if (args.include_attachments && messageResponse.data.messageData.hasAttachments) {
                    const attachmentResponse = await scope.$http.post("~/api/v1/mail/message/attachments", parameters);
                    messageResponse.data.messageData.attachments = attachmentResponse.data.attachments;
                }

                return { success: true, result: messageResponse.data.messageData };
            } catch (error) {
                scope.logError('Error fetching email:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetCalendarEvents = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: "get_calendar_events",
            description: "Get calendar events for a given date range",
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the calendar folder (default: primary calendar)'
                    },
                    start_date: {
                        type: 'string',
                        description: 'The start date of the range to get events for (YYYY-MM-DDTHH:mm:ss)'
                    },
                    end_date:{
                        type: 'string',
                        description: 'The end date of the range to get events for (YYYY-MM-DDTHH:mm:ss)'
                    },
                    search_query: {
                        type: 'string',
                        description: 'Optional search query to filter events'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 10)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from (default = 0)'
                    }
                },
                required: ['start_date', 'end_date']
            }
        },
        execute: async function(scope, args) {
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const maxResults = args.max_results || 10;
            const startIndex = args.startIndex || 0;
            const calId = args.folder_id || args.calendar_id;
            const calendars = await cs.getCalendars();
            const calendarId = calId ? (calendars.find(x => x.id == calId || x.folderId == calId)?.id || calendars.find(x => x.isPrimary)?.id) : calendars.find(x => x.isPrimary)?.id;

            const calendar = calendars.find(x => x.id == calendarId);
            
            const startDate = moment(args.start_date);
            const endDate = moment(args.end_date);


            var params = JSON.stringify({
                startDate: moment.utc(startDate),
                endDate: moment.utc(endDate),
            });
            var result = await scope.$http.post("~/api/v1/calendars/events/" + calendar.owner + "/" + calendar.id, params);
            var events = result.data.events;

            return { success: true, result: events };
        }
    };

    static GetNotes = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_notes',
            description: 'Get notes sorted by most recently edited',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the notes folder (default: primary)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 5)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from (default = 0)'
                    },
                    search_text: {
                        type: 'string',
                        description: "Text to search for in notes (default = '')"
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const notesService = scope.getService('coreDataNotes');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            await notesService.ensureSourcesLoadedPromise();
            await notesService.ensureNotesLoadedPromise();
            
            const sources = notesService.getSources();
            scope.logMessage('SOURCES', sources);
            // Set search parameters if provided
            if (args.search_text) {
                notesService.parameters.searchText = args.search_text;
            }

            // Get filtered notes
            const notes = notesService.getFilteredNotes();
            
            // Apply pagination
            const paginatedNotes = notes.slice(startIndex, startIndex + maxResults);
            
            // Format the response
            const formattedNotes = paginatedNotes.map(note => ({
                id: note.id,
                title: note.subject,
                content: note.text,
                color: note.color,
                dateCreated: note.dateCreated,
                lastModified: note.lastModifiedUTC,
                categories: note.categoriesString,
                hasAttachments: note.hasAttachments
            }));

            return { success: true, result: formattedNotes };
        }
    };

    static GetTasks = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: "get_tasks",
            description: "Get tasks sorted by most recently edited",
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the tasks folder (default: primary)'
                    },
                    max_results: {
                        type: "number",
                        description: "The maximum number of results to return (default = 5)"
                    },
                    startIndex: {
                        type: "number",
                        description: "The index to start from"
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const tasksService = scope.getService('coreDataTasks');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            // Load sources and tasks
            await tasksService.ensureSourcesLoadedPromise();
            await tasksService.ensureTasksLoadedPromise();

            // Get filtered tasks
            const tasks = tasksService.getFilteredTasks();
            
            // Apply pagination
            const paginatedTasks = tasks.slice(startIndex, startIndex + maxResults);
            
            return { success: true, result: paginatedTasks };
        }
    };

    static GetContacts = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_contacts',
            description: 'Get contacts sorted by most recently contacted',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the contact folder (default: primary)'
                    },
                    search_query: {
                        type: 'string',
                        description: 'The search query to filter contacts by (searches all fields)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 5)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const contactsService = scope.getService('coreDataContacts');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            // Set search parameters if provided
            if (args.search_query) {
                contactsService.parameters.searchText = args.search_query;
            }

            // Load sources and contacts
            await contactsService.ensureSourcesLoadedPromise();
            await contactsService.ensureContactsLoadedPromise();

            // Get filtered contacts
            const contacts = contactsService.getFilteredContacts();
            
            // Apply pagination
            const paginatedContacts = contacts.slice(startIndex, startIndex + maxResults);

            const mappedContacts = paginatedContacts.map(contact => ({  
                id: contact.id,
                name: contact.displayAs,
                email: contact.emailAddressList[0] || undefined,
                phone: contact.phoneNumberList[0]?.number || undefined,
                quick_notes: contact.additionalInfo || undefined,
                flagInfo: contact.flagInfo,
                categories: contact.categoriesString || undefined
            }));
            
            return { success: true, result: mappedContacts };
        }
    };

    //static OpenComposerWindow = {
    //    function: {
    //        name: "OpenComposerWindow",
    //        description: "Open the email composer window",
    //        parameters: {
    //            properties: {
    //                ai_prompt: {
    //                    type: "string",
    //                    description: "The prompt that will be given to the reasoning model to generate the email content once the window is opened"
    //                }
    //            }
    //        }
    //    },
    //    execute: async function(scope, args) {
    //        // Open composer window with AI prompt
    //        const composerWindow = window.open('/composer', 'composer', 'width=800,height=600');
    //        composerWindow.aiPrompt = args.ai_prompt;
    //        return { success: true, result: `Composer window opened` };
    //    }
    //};

    static NewOrUpdateNote = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'new_or_update_note',
            description: 'Create a new note or update an existing one',
            parameters: {
                properties: {
                    title: {
                        type: 'string',
                        description: 'The title of the note'
                    },
                    content: {
                        type: 'string', 
                        description: 'The content of the note'
                    },
                    note_id: {
                        type: 'string',
                        description: 'The id of the note to update (guid)'
                    },
                    color: {
                        type: 'string',
                        description: 'The color of the note (white, yellow, pink, green, blue)'
                    }
                },
                required: ['title', 'content']
            }
        },
        execute: async function(scope, args) {
            try {
                // First get the primary source
                const sourcesResult = await scope.$http.get("~/api/v1/notes/sources");
                const sources = sourcesResult.data.sharedLists;
                const primarySource = sources.find(s => s.isPrimary);
                
                if (!primarySource) {
                    throw new Error('No primary notes source found');
                }

                // Format note object according to API requirements
                const note = {
                    subject: args.title,
                    text: `<div>${args.content}</div>`, // Wrap content in div as expected by the API
                    color: args.color || 'white',
                    sourceOwner: primarySource.ownerUsername || "~",
                    sourceId: primarySource.itemID,
                    sourceName: primarySource.displayName,
                    sourcePermission: primarySource.access,
                    isVisible: primarySource.enabled
                };

                if (args.note_id) {
                    note.id = args.note_id;
                    // Update existing note
                    const params = JSON.stringify(note);
                    await scope.$http.post(`~/api/v1/notes/note-patch/${note.id}/${note.sourceId}/${note.sourceOwner}`, params);
                } else {
                    // Create new note
                    const params = JSON.stringify(note);
                    await scope.$http.post(`~/api/v1/notes/note-put/${note.sourceId}/${note.sourceOwner}/`, params);
                }

                return { success: true, result: `Note ${args.title} saved` };
            } catch (error) {
                scope.logError('Error saving note:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static NewOrUpdateContact = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'new_or_update_contact',
            description: 'Create a new contact or update an existing one',
            parameters: {
                properties: {
                    name: {
                        type: 'string',
                        description: 'Display name of the contact (also used as DisplayAs)'
                    },
                    first_name: {
                        type: 'string',
                        description: 'First name of the contact'
                    },
                    last_name: {
                        type: 'string',
                        description: 'Last name of the contact'
                    },
                    email: {
                        type: 'string',
                        description: 'The email address of the contact'
                    },
                    phone: {
                        type: 'string',
                        description: 'The phone number of the contact'
                    },
                    company: {
                        type: 'string',
                        description: 'Company name'
                    },
                    job_title: {
                        type: 'string',
                        description: 'Job title'
                    },
                    home_street: { type: 'string', description: 'Home street address' },
                    home_city: { type: 'string', description: 'Home city' },
                    home_state: { type: 'string', description: 'Home state' },
                    home_zip: { type: 'string', description: 'Home zip code' },
                    home_country: { type: 'string', description: 'Home country' },
                    bus_street: { type: 'string', description: 'Business street address' },
                    bus_city: { type: 'string', description: 'Business city' },
                    bus_state: { type: 'string', description: 'Business state' },
                    bus_zip: { type: 'string', description: 'Business zip code' },
                    bus_country: { type: 'string', description: 'Business country' },
                    web_page: { type: 'string', description: 'Web page URL' },
                    additional_info: {
                        type: 'string',
                        description: 'Additional notes about the contact (can be HTML)'
                    },
                    quick_notes: {
                        type: 'string',
                        description: 'Quick notes about the contact (alias for additional_info)'
                    },
                    address: {
                        type: 'string',
                        description: 'Address (alias for bus_street)'
                    },
                    is_html: {
                        type: 'boolean',
                        description: 'Whether additional info is HTML formatted'
                    },
                    folder_id: {
                        type: 'string',
                        description: 'The contact folder ID (default: primary)'
                    },
                    contact_id: {
                        type: 'string',
                        description: 'The id of the contact to update (guid)'
                    }
                },
                required: ['name']
            }
        },
        execute: async function(scope, args) {
            try {
                const { sourceOwner, sourceId } = await SmarterMailTools._resolveContactSourcePath(scope, args.folder_id);
                const userInfo = await scope.getUserInfo();

                // Build display name
                const displayAs = args.name || (args.first_name && args.last_name ? `${args.first_name} ${args.last_name}` : args.first_name || args.last_name || '');

                const payload = {
                    DisplayAs: displayAs,
                    FirstName: args.first_name || '',
                    LastName: args.last_name || '',
                    Company: args.company || '',
                    JobTitle: args.job_title || '',
                    WebPage: args.web_page || '',
                    AdditionalInfo: args.additional_info || args.quick_notes || '',
                    IsHtml: args.is_html || false,
                    EmailAddressList: args.email ? [args.email] : [],
                    PhoneNumberList: args.phone ? [{ Number: args.phone, PhoneType: 0 }] : [],
                    HomeStreet: args.home_street || '',
                    HomeCity: args.home_city || '',
                    HomeState: args.home_state || '',
                    HomePostalCode: args.home_zip || '',
                    HomeCountry: args.home_country || '',
                    BusinessStreet: args.bus_street || args.address || '',
                    BusinessCity: args.bus_city || '',
                    BusinessState: args.bus_state || '',
                    BusinessPostalCode: args.bus_zip || '',
                    BusinessCountry: args.bus_country || ''
                };

                if (args.contact_id) {
                    payload.Id = args.contact_id;
                }

                await scope.$http.post(`~/api/v1/contacts/contact-put/${userInfo.username}/${sourceId}`, JSON.stringify(payload));
                return { success: true, result: `Contact ${displayAs} saved` };
            } catch (error) {
                scope.logError('Error saving contact:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static NewOrUpdateTask = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'new_or_update_task',
            description: 'Create a new task or update an existing one',
            parameters: {
                properties: {
                    task_id: {
                        type: 'string',
                        description: 'The id of the task to update (guid)'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the task'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the task'
                    },
                    percent_complete: {
                        type: 'number',
                        description: 'The percentage of the task that is complete (0-100)'
                    },
                    start: {
                        type: 'string',
                        description: 'The start date of the task (YYYY-MM-DD HH:mm)'
                    },
                    due: {
                        type: 'string',
                        description: 'The due date of the task (YYYY-MM-DD HH:mm)'
                    },
                    reminder: {
                        type: 'string',
                        description: 'The reminder date of the task (YYYY-MM-DD HH:mm)'
                    }
                },
                required: ['subject']
            }
        },
        execute: async function(scope, args) {
            const tasksService = scope.getService('coreDataTasks');

            await tasksService.ensureSourcesLoadedPromise();
            await tasksService.ensureTasksLoadedPromise();
            
            const sources = tasksService.getSources();
            
            // Find primary source
            const primarySource = sources.find(s => s.isPrimary);
            if (!primarySource) {
                throw new Error('No primary tasks source found');
            }

            if(args.due && !args.start) {
                args.start = moment().toDate();
            }


            const task = {
                id: args.task_id || null,
                description: args.description,
                subject: args.subject,
                percentComplete: args.percent_complete || 0,
                due: args.due ? moment(args.due).toDate() : null,
                start: args.start ? moment(args.start).toDate() : null,
                reminder: args.reminder ? moment(args.reminder).toDate() : null,
                sourceOwner: primarySource.owner,
                sourceId: primarySource.id,
                useDateTime: (args.start || args.due) ? true : false,
                reminderSet: args.reminder ? true : false
            };

            scope.logMessage('TASK', task, args.due, args.start);

            // Use saveTasks for both new and update
            await tasksService.saveTasks([task]);

            return { success: true, result: `Task ${args.subject} saved` };
        }
    };

    static NewOrUpdateCalendarEvent = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'new_or_update_calendar_event',
            description: 'Create a new calendar event or update an existing one',
            parameters: {
                properties: {
                    event_id: {
                        type: 'string',
                        description: 'The id of the event to update (if it exists)'
                    },
                    subject: {
                        type: 'string',
                        description: 'The title of the event'
                    },
                    start_time: {
                        type: 'string',
                        description: 'The start time of the event (YYYY-MM-DDTHH:mm:ss)'
                    },
                    end_time: {
                        type: 'string',
                        description: 'The end time of the event (YYYY-MM-DDTHH:mm:ss)'
                    },
                    location: {
                        type: 'string',
                        description: 'The location of the event'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the event'
                    },
                    attendees: {
                        type: 'string',
                        description: 'Comma-separated list of email addresses of attendees'
                    },
                    folder_id: {
                        type: 'string',
                        description: 'The id of the calendar folder (default is primary calendar)'
                    },
                    calendar_id: {
                        type: 'string',
                        description: 'The id of the calendar to add/update the event to (alias for folder_id, default is primary calendar)'
                    }
                },
                required: ['subject', 'start_time', 'end_time']
            }
        },
        execute: async function(scope, args) {
            let responseContext = '';
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const calendars = await cs.getCalendars();
            const calId = args.folder_id || args.calendar_id;
            let calendar = calId ? calendars.find(x=> x.id == calId || x.folderId == calId) : calendars.find(x=> x.isPrimary);

            if (!calendar) {
                responseContext = `Calendar (${calId}) not found, using primary calendar`;
                calendar = calendars.find(x=> x.isPrimary);
            }

            // Format the event object according to API requirements
            const event = {
                id: args.event_id || null,
                subject: args.subject,
                start: {
                    dt: moment(args.start_time).toISOString(),
                    tz: moment.tz.guess()
                },
                end: {
                    dt: moment(args.end_time).toISOString(),
                    tz: moment.tz.guess()
                },
                location: args.location,
                description: args.description,
                calendarId: calendar.id,
                calendarOwner: calendar.owner || null
            };

            // Add attendees if provided
            if (args.attendees) {
                event.attendees = args.attendees.split(',').map(e => ({ email: e.trim() })).filter(a => a.email);
            }

            try {
                if (args.event_id) {
                    // Update existing event
                    await scope.$http.post(`~/api/v1/calendars/events/save/${calendar.owner}/${calendar.id}/${args.event_id}`, JSON.stringify(event));
                } else {
                    // Create new event
                    await scope.$http.post(`~/api/v1/calendars/events/save/${calendar.owner}/${calendar.id}/null`, JSON.stringify(event));
                }

                return { success: true, result: `Event ${args.subject} saved. ${responseContext}` };
            } catch (error) {
                scope.logError('Error saving event:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SendMeetingInvite = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'send_meeting_invite',
            description: 'Send a meeting invite',
            parameters: {
                properties: {
                    to: {
                        type: 'string',
                        description: 'The email addresses to send the meeting invite to, separated by commas'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the meeting'
                    },
                    start_time: {
                        type: 'string',
                        description: 'The start time of the meeting'
                    },
                    end_time: {
                        type: 'string',
                        description: 'The end time of the meeting'
                    },
                    location: {
                        type: 'string',
                        description: 'The location of the meeting'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the meeting'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const calendarService = scope.getService('coreDataCalendar');
            const emailService = scope.getService('coreDataMail');

            // Create calendar event
            const event = {
                title: args.subject,
                start: moment(args.start_time).toDate(),
                end: moment(args.end_time).toDate(),
                location: args.location,
                description: args.description
            };

            // Add event to calendar
            await calendarService.addEvents([event]);

            // Send email invite
            const emailData = {
                to: args.to,
                subject: args.subject,
                body: `You are invited to: ${args.subject}\n\nWhen: ${args.start_time} - ${args.end_time}\nWhere: ${args.location}\n\n${args.description}`,
                isHtml: false
            };

            await emailService.sendEmail(emailData);
            return { success: true, result: `Meeting invite sent to ${args.to}` };
        }
    };

    static RemoveItems = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'remove_items',
            description: 'Remove items from the system',
            parameters: {
                properties: {
                    item_id: {
                        type: 'string',
                        description: "The id's of the items to remove, comma separated. (id/guid only)"
                    },
                    item_type: {
                        type: 'string',
                        description: 'The type of the item to remove - note, task, contact, event'
                    },
                    calendar_id: {
                        type: 'string',
                        description: 'The id of the calendar to remove the event from'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const ids = args.item_id.split(',').map(id => id.trim());
            const type = args.item_type.toLowerCase();
            const calendarId = args.calendar_id;
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const calendar = (await cs.getCalendars()).filter(x=> x.id == calendarId)[0];
            try{
                let service;
                switch(type) {
                    case 'note':
                        service = scope.getService('coreDataNotes');
                        await service.removeNotes(ids);
                        break;
                    case 'task':
                        service = scope.getService('coreDataTasks');
                        await service.removeTasks(ids);
                        break;
                    case 'contact':
                        // Get contacts service to find source info for the contacts
                        service = scope.getService('coreDataContacts');
                        await service.ensureSourcesLoadedPromise();
                        await service.ensureContactsLoadedPromise();
                        
                        // Find the contacts to get their source info
                        const contacts = ids.map(id => service.getContactById(id))
                            .filter(contact => contact && contact.sourceId !== "gal") // Filter out null contacts and GAL contacts
                            .map(contact => ({
                                sourceOwner: contact.sourceOwner,
                                sourceId: contact.sourceId,
                                id: contact.id
                            }));

                        if (contacts.length === 0) {
                            throw new Error('No valid contacts found to delete');
                        }

                        // Call delete-bulk API directly
                        await scope.$http.post('~/api/v1/contacts/delete-bulk', JSON.stringify(contacts));
                        break;
                    case 'event':
                        var deleteMetaData = [];
                        for(var i = 0; i < ids.length; i++){
                            deleteMetaData.push({ "owner": calendar.owner, "calendarId": calendar.id, "eventId": ids[i] });
                        }

                        scope.logMessage('DELETE METADATA', deleteMetaData);
                        const params = JSON.stringify(deleteMetaData);
                        var result = await scope.$http.post('~/api/v1/calendars/events/delete-bulk/', params);
                        scope.logMessage('DELETE RESULT', result);

                        await cs.removeCalendarEvents(ids);
                        break;
                    default:
                        throw new Error('Invalid item type');
                }
            }catch(e){
                scope.logError('Error removing items', e);
                return { success: false, error: e.message };
            }

            return { success: true, result: `Items removed` };
        }
    };

    static RemoveEmails = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'remove_emails',
            description: 'Remove emails from the system',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The id's of the emails to remove, comma separated."
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to remove the emails from.'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const mailService = scope.getService('coreDataMail');
            const uids = args.uid.split(',').map(id => id.trim());

            const parameters = {
                'UID': uids,
                'folder': args.folder,
                'ownerEmailAddress': '',
                'moveToDeleted': true
            };

            await scope.$http.post("~/api/v1/mail/delete-messages", parameters);
            return { success: true, result: `Emails removed` };
        }
    };

    static MoveEmails = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'move_emails',
            description: 'Move emails to a different folder',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The uid's of the emails to move, comma separated (get uids with read_emails_fast tool)."
                    },
                    src_folder: {
                        type: 'string',
                        description: 'The folder the emails are in.'
                    },
                    dest_folder: {
                        type: 'string',
                        description: 'The folder to move the emails to.'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');

            //uids need to not be strings
            const uids = args.uid.split(',').map(id => id.trim()).map(id => parseInt(id));

            //if src_folder is an integer, its a folder_id, fetch email folders and get the path
            if(typeof args.src_folder === 'number'){
                await coreMailService.loadMailTree();
                const folders = await coreMailService.getFolderList();
                const folder = folders.find(x => x.id == args.src_folder);
                args.src_folder = folder.path;
            }

            //if dest_folder is an integer, its a folder_id, fetch email folders and get the path
            if(typeof args.dest_folder === 'number'){
                await coreMailService.loadMailTree();
                const folders = await coreMailService.getFolderList();
                const folder = folders.find(x => x.id == args.dest_folder);
                args.dest_folder = folder.path;
            }


            const parameters = {
                'UID': uids,
                'folder': args.src_folder,
                'ownerEmailAddress': '',
                'destinationFolder': args.dest_folder,
                'destinationOwnerEmailAddress': ''
            };

            await scope.$http.post("~/api/v1/mail/move-messages", parameters);
            return { success: true, result: `Emails moved to ${args.dest_folder}` };
        }
    };

    static SetEmailProperties = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'set_email_properties',
            description: 'Mark emails as read/unread, flagged/unflagged, or add tags',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The id's of the emails to mark, comma separated."
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder the emails are in.'
                    },
                    read: {
                        type: 'boolean',
                        description: 'Whether to mark the emails as read or unread'
                    },
                    flagged: {
                        type: 'boolean',
                        description: 'Whether to mark the emails as flagged or unflagged'
                    },
                    tags: {
                        type: 'string',
                        description: 'The tags to add to the emails, comma separated'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const mailService = scope.getService('coreDataMail');
            const uids = args.uid.split(',').map(id => id.trim());

            const parameters = {
                'UID': uids,
                'folder': args.folder,
                'ownerEmailAddress': ''
            };

            if (args.read !== undefined) {
                parameters.markRead = args.read;
            }

            if (args.flagged !== undefined) {
                parameters.flagAction = {
                    type: args.flagged ? 'SetBasic' : 'Clear'
                };
            }

            if (args.tags) {
                parameters.categories = args.tags.split(',').map(tag => tag.trim());
            }

            await scope.$http.post("~/api/v1/mail/messages-patch", parameters);
            return { success: true, result: `Emails marked as ${args.read ? 'read' : 'unread'}, ${args.flagged ? 'flagged' : 'unflagged'}, and tagged with ${args.tags}` };
        }
    };

    static SendEmail = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: "send_email",
            description: "Send a simple email",
            parameters: {
                properties: {
                    to: {
                        type: 'string',
                        description: 'The email addresses to send the email to, separated by commas'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the email'
                    },
                    body: {
                        type: 'string',
                        description: 'The body of the email'
                    },
                    cc: {
                        type: 'string',
                        description: 'The email address to cc'
                    },
                    bcc: {
                        type: 'string',
                        description: 'The email address to bcc'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {

                var userInfo = scope.getUserInfo();

                const emailData = {
                    to: args.to,
                    subject: args.subject,
                    body: args.body,
                    cc: args.cc,
                    bcc: args.bcc,
                    isHtml: false
                };


                // Check if the to field is empty
                if(!emailData.to || emailData.to.length == 0 || emailData.to == 'undefined' || emailData.to == 'null'){
                    emailData.to = userInfo.emailAddress;
                }

                if(!emailData.subject || emailData.subject.length == 0 || emailData.subject == 'undefined' || emailData.subject == 'null'){
                    emailData.subject = 'No subject';
                }

                if(!emailData.body || emailData.body.length == 0 || emailData.body == 'undefined' || emailData.body == 'null'){
                    emailData.body = 'No body';
                }

                // Post directly to the mail API endpoint
                await scope.$http.post('~/api/v1/mail/message-put', {
                    to: emailData.to,
                    cc: emailData.cc || '',
                    bcc: emailData.bcc || '',
                    date: new Date(),
                    from: userInfo.emailAddress,
                    replyTo: userInfo.emailAddress,
                    subject: emailData.subject,
                    messageHTML: `<div>${emailData.body}</div>`,
                    priority: 1,
                    selectedFrom: `default:${userInfo.emailAddress}`
                });

                return { success: true, result: 'Email sent successfully' };
            } catch (error) {
                scope.logError('Error sending email:', error);
                return { success: false, error: error.message };
            }
        }
    };
    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    static _resolveCalendarPath = async (scope, folderId) => {
        const cs = scope.getService('coreDataCalendar');
        await cs.loadSources();
        const calendars = await cs.getCalendars();
        let calendar = folderId
            ? calendars.find(x => x.id == folderId || x.folderId == folderId)
            : calendars.find(x => x.isPrimary);
        if (!calendar) throw new Error(`Calendar not found: ${folderId}`);
        return { owner: calendar.owner, calId: calendar.id, calendar };
    };

    static _resolveContactSourcePath = async (scope, folderId) => {
        const result = await scope.$http.get("~/api/v1/contacts/sources");
        const sources = result.data?.sharedLists || result.sharedLists || [];
        let source = folderId
            ? sources.find(s => s.itemID == folderId || s.folderId == folderId)
            : sources.find(s => s.isPrimary);
        if (!source) throw new Error(`Contact source not found: ${folderId}`);
        return { sourceOwner: source.ownerUsername || "~", sourceId: source.itemID, source };
    };

    static _resolveNoteSourcePath = async (scope, folderId) => {
        const result = await scope.$http.get("~/api/v1/notes/sources");
        const sources = result.data?.sharedLists || result.sharedLists || [];
        let source = folderId
            ? sources.find(s => s.itemID == folderId || s.folderId == folderId)
            : sources.find(s => s.isPrimary);
        if (!source) throw new Error(`Note source not found: ${folderId}`);
        return { sourceOwner: source.ownerUsername || "~", sourceId: source.itemID, source };
    };

    static _resolveTaskSourcePath = async (scope, folderId) => {
        const result = await scope.$http.get("~/api/v1/tasks/sources");
        const sources = result.data?.sharedLists || result.sharedLists || [];
        let source = folderId
            ? sources.find(s => s.itemID == folderId || s.folderId == folderId || s.id == folderId)
            : sources.find(s => s.isPrimary);
        if (!source) throw new Error(`Task source not found: ${folderId}`);
        return { sourceOwner: source.owner || source.ownerUsername || "~", sourceId: source.id || source.itemID, source };
    };

    // ============================================================
    // MAIL TOOLS - Reply, Forward, Attachments
    // ============================================================

    static ReplyToEmail = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'reply_to_email',
            description: 'Reply to an email message',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: 'The UID of the email to reply to'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder where the original email is located (default: inbox)'
                    },
                    body: {
                        type: 'string',
                        description: 'The reply message body (HTML supported)'
                    },
                    reply_all: {
                        type: 'boolean',
                        description: 'Set to true to reply to all recipients (default: false)'
                    }
                },
                required: ['uid', 'body']
            }
        },
        execute: async function(scope, args) {
            try {
                const folder = args.folder || 'inbox';
                const userInfo = await scope.getUserInfo();

                // Fetch the original message
                const msgResult = await scope.$http.post("~/api/v1/mail/message", {
                    Folder: folder,
                    UID: args.uid,
                    OwnerEmailAddress: ""
                });
                const msg = msgResult.data?.messageData || msgResult.messageData;
                if (!msg) return { success: false, error: 'Original message not found' };

                // Build recipients
                let to = msg.fromAddress?.email || msg.from;
                let cc = '';

                if (args.reply_all) {
                    // Include all original To and CC recipients, excluding current user
                    const allRecipients = [
                        ...(msg.toAddresses || []),
                        ...(msg.ccAddresses || [])
                    ].filter(addr => addr.email && addr.email.toLowerCase() !== userInfo.emailAddress.toLowerCase()
                        && addr.email.toLowerCase() !== to.toLowerCase());
                    cc = allRecipients.map(addr => addr.email).join('; ');
                }

                // Build subject
                let subject = msg.subject || '';
                if (!subject.match(/^Re:/i)) {
                    subject = `Re: ${subject}`;
                }

                await scope.$http.post('~/api/v1/mail/message-put', {
                    to: to,
                    cc: cc,
                    bcc: '',
                    date: new Date(),
                    from: userInfo.emailAddress,
                    replyTo: userInfo.emailAddress,
                    subject: subject,
                    messageHTML: `<div style="font-family: arial; font-size: 14px;">${args.body}</div>`,
                    priority: 1,
                    replyUid: parseInt(args.uid),
                    replyOwner: "",
                    replyFromFolder: folder,
                    actions: { "1": true },
                    sendImmediately: true,
                    selectedFrom: `default:${userInfo.emailAddress}`
                });

                return { success: true, result: `Reply sent to ${to}${args.reply_all ? ' (reply all)' : ''}` };
            } catch (error) {
                scope.logError('Error replying to email:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ForwardEmail = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'forward_email',
            description: 'Forward an email message to other recipients',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: 'The UID of the email to forward'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder where the original email is located (default: inbox)'
                    },
                    to: {
                        type: 'string',
                        description: 'The email addresses to forward to, comma separated'
                    },
                    message: {
                        type: 'string',
                        description: 'Optional message to include above the forwarded content'
                    }
                },
                required: ['uid', 'to']
            }
        },
        execute: async function(scope, args) {
            try {
                const folder = args.folder || 'inbox';
                const userInfo = await scope.getUserInfo();

                // Fetch the original message
                const msgResult = await scope.$http.post("~/api/v1/mail/message", {
                    Folder: folder,
                    UID: args.uid,
                    OwnerEmailAddress: ""
                });
                const msg = msgResult.data?.messageData || msgResult.messageData;
                if (!msg) return { success: false, error: 'Original message not found' };

                // Build subject
                let subject = msg.subject || '';
                if (!subject.match(/^(Fwd?|Fw):/i)) {
                    subject = `Fwd: ${subject}`;
                }

                // Format recipients
                const toAddresses = args.to.split(',').map(e => e.trim()).join('; ');

                // Build body
                let body = '';
                if (args.message) {
                    body = `<div style="font-family: arial; font-size: 14px;">${args.message}</div><br/>`;
                }

                await scope.$http.post('~/api/v1/mail/message-put', {
                    to: toAddresses,
                    cc: '',
                    bcc: '',
                    date: new Date(),
                    from: userInfo.emailAddress,
                    replyTo: userInfo.emailAddress,
                    subject: subject,
                    messageHTML: body,
                    priority: 1,
                    replyUid: parseInt(args.uid),
                    replyOwner: "",
                    replyFromFolder: folder,
                    actions: { "2": true },
                    excludeFiles: [],
                    sendImmediately: true,
                    selectedFrom: `default:${userInfo.emailAddress}`
                });

                return { success: true, result: `Email forwarded to ${args.to}` };
            } catch (error) {
                scope.logError('Error forwarding email:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetEmailAttachments = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_email_attachments',
            description: 'Get attachments from an email message',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: 'The UID of the email'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder where the email is located (default: inbox)'
                    }
                },
                required: ['uid']
            }
        },
        execute: async function(scope, args) {
            try {
                const folder = args.folder || 'inbox';
                const params = {
                    Folder: folder,
                    UID: args.uid,
                    OwnerEmailAddress: ""
                };

                const msgResult = await scope.$http.post("~/api/v1/mail/message", params);
                const msg = msgResult.data?.messageData || msgResult.messageData;
                if (!msg) return { success: false, error: 'Message not found' };

                if (!msg.hasAttachments) {
                    return { success: true, result: { attachmentCount: 0, attachments: [] } };
                }

                // Get attachment details
                const attachResult = await scope.$http.post("~/api/v1/mail/message/attachments", params);
                const attachments = (attachResult.data?.attachments || attachResult.attachments || []).map((att, index) => ({
                    filename: att.filename || att.name,
                    size: att.size,
                    contentType: att.contentType,
                    contentId: att.contentId,
                    isInline: att.isInline || false,
                    index: att.index ?? index
                }));

                return { success: true, result: { attachmentCount: attachments.length, attachments } };
            } catch (error) {
                scope.logError('Error getting attachments:', error);
                return { success: false, error: error.message };
            }
        }
    };

    // ============================================================
    // CALENDAR TOOLS - GetEvent, Delete, RespondToMeeting
    // ============================================================

    static GetCalendarEvent = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_calendar_event',
            description: 'Get details of a specific calendar event',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the calendar folder'
                    },
                    event_id: {
                        type: 'string',
                        description: 'The ID of the event to retrieve'
                    }
                },
                required: ['folder_id', 'event_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const { owner, calId } = await SmarterMailTools._resolveCalendarPath(scope, args.folder_id);
                const result = await scope.$http.get(`~/api/v1/calendars/events/${owner}/${calId}/${args.event_id}`);
                return { success: true, result: result.data || result };
            } catch (error) {
                scope.logError('Error getting calendar event:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static DeleteCalendarEvent = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'delete_calendar_event',
            description: 'Delete a calendar event',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the calendar folder'
                    },
                    event_id: {
                        type: 'string',
                        description: 'The ID of the event to delete'
                    }
                },
                required: ['folder_id', 'event_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const { owner, calId } = await SmarterMailTools._resolveCalendarPath(scope, args.folder_id);
                await scope.$http.post(`~/api/v1/calendars/events/delete/${owner}/${calId}/${args.event_id}/true`);
                return { success: true, result: 'Event deleted' };
            } catch (error) {
                scope.logError('Error deleting calendar event:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static RespondToMeeting = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'respond_to_meeting',
            description: 'Respond to a meeting invitation (accept, decline, or tentative)',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the calendar folder containing the meeting'
                    },
                    event_id: {
                        type: 'string',
                        description: 'The event ID of the meeting'
                    },
                    response: {
                        type: 'string',
                        description: "Response type: 'accept', 'decline', or 'tentative'"
                    },
                    comment: {
                        type: 'string',
                        description: 'Optional comment to include with your response'
                    }
                },
                required: ['folder_id', 'event_id', 'response']
            }
        },
        execute: async function(scope, args) {
            try {
                const response = args.response.toLowerCase();
                if (!['accept', 'decline', 'tentative'].includes(response)) {
                    return { success: false, error: "Response must be 'accept', 'decline', or 'tentative'" };
                }

                const { owner, calId } = await SmarterMailTools._resolveCalendarPath(scope, args.folder_id);

                const endpointMap = {
                    'accept': 'meeting-accept',
                    'decline': 'meeting-decline',
                    'tentative': 'meeting-tentatively-accept'
                };

                const payload = args.comment ? { replyingComment: args.comment } : {};
                await scope.$http.post(`~/api/v1/calendars/${endpointMap[response]}/${owner}/${calId}/${args.event_id}`, payload);

                return { success: true, result: `Meeting ${response}ed` };
            } catch (error) {
                scope.logError('Error responding to meeting:', error);
                return { success: false, error: error.message };
            }
        }
    };

    // ============================================================
    // CONTACT TOOLS - GetContact, GlobalAddressBook, Delete
    // ============================================================

    static GetContact = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_contact',
            description: 'Get full details for a specific contact',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the contact folder'
                    },
                    contact_id: {
                        type: 'string',
                        description: 'The ID of the contact to retrieve'
                    }
                },
                required: ['folder_id', 'contact_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const { sourceOwner, sourceId } = await SmarterMailTools._resolveContactSourcePath(scope, args.folder_id);
                const result = await scope.$http.get(`~/api/v1/contacts/get/${sourceOwner}/${sourceId}/${args.contact_id}/`);
                return { success: true, result: result.data || result };
            } catch (error) {
                scope.logError('Error getting contact:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetGlobalAddressBook = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_global_address_book',
            description: 'Get contacts from the global address book (domain contacts)'
        },
        execute: async function(scope, args) {
            try {
                const result = await scope.$http.get("~/api/v1/contacts/domain");
                const contacts = (result.data?.domainContacts || result.domainContacts || []).map(c => ({
                    id: c.id,
                    username: c.username,
                    displayAs: c.displayAs || c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.username,
                    emailAddress: c.emailAddressList?.[0] || c.emailAddress || c.email
                }));
                return { success: true, result: contacts };
            } catch (error) {
                scope.logError('Error getting global address book:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static DeleteContacts = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'delete_contacts',
            description: 'Delete contacts from the specified folder',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the contact folder'
                    },
                    contact_ids: {
                        type: 'string',
                        description: 'The IDs of the contacts to delete, comma separated'
                    }
                },
                required: ['folder_id', 'contact_ids']
            }
        },
        execute: async function(scope, args) {
            try {
                const { sourceOwner, sourceId } = await SmarterMailTools._resolveContactSourcePath(scope, args.folder_id);
                const ids = args.contact_ids.split(',').map(id => id.trim());
                const deletePayload = ids.map(id => ({
                    sourceOwner: sourceOwner,
                    sourceId: sourceId,
                    id: id
                }));

                await scope.$http.post('~/api/v1/contacts/delete-bulk', JSON.stringify(deletePayload));
                return { success: true, result: `Deleted ${ids.length} contact(s)` };
            } catch (error) {
                scope.logError('Error deleting contacts:', error);
                return { success: false, error: error.message };
            }
        }
    };

    // ============================================================
    // CONTACT GROUP TOOLS
    // ============================================================

    static GetContactGroups = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_contact_groups',
            description: 'Get all contact groups from a specific folder',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the contact folder'
                    }
                },
                required: ['folder_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const { sourceOwner, sourceId } = await SmarterMailTools._resolveContactSourcePath(scope, args.folder_id);
                const result = await scope.$http.get(`~/api/v1/contacts/address-book/${sourceOwner}/${sourceId}/`);
                const contacts = result.data?.contacts || result.contacts || [];
                const groups = contacts.filter(c => c.contactType === 2).map(g => ({
                    id: g.id,
                    name: g.displayAs,
                    description: g.additionalInfo || '',
                    memberCount: g.groupedContacts?.length || 0,
                    memberEmails: (g.groupedContacts || []).map(m => m.emailAddress).filter(Boolean)
                }));
                return { success: true, result: groups };
            } catch (error) {
                scope.logError('Error getting contact groups:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetContactGroup = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_contact_group',
            description: 'Get details of a specific contact group including all members',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the contact folder'
                    },
                    group_id: {
                        type: 'string',
                        description: 'The ID of the contact group'
                    }
                },
                required: ['folder_id', 'group_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const { sourceOwner, sourceId } = await SmarterMailTools._resolveContactSourcePath(scope, args.folder_id);
                const result = await scope.$http.get(`~/api/v1/contacts/get/${sourceOwner}/${sourceId}/${args.group_id}/`);
                const group = result.data || result;
                if (group.contactType !== 2) {
                    return { success: false, error: 'The specified ID is not a contact group' };
                }
                const members = (group.groupedContacts || []).map(m => ({
                    type: m.type,
                    typeName: m.type === 0 ? 'OneOff' : m.type === 1 ? 'Contact' : m.type === 2 ? 'Group' : 'Unknown',
                    emailAddress: m.emailAddress,
                    displayName: m.displayName,
                    contactId: m.contactId,
                    folderId: m.folderId
                }));
                return { success: true, result: { id: group.id, name: group.displayAs, description: group.additionalInfo, members } };
            } catch (error) {
                scope.logError('Error getting contact group:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CreateContactGroup = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'create_contact_group',
            description: 'Create a new contact group in the specified folder',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the contact folder'
                    },
                    group_name: {
                        type: 'string',
                        description: 'The name of the contact group'
                    },
                    member_emails: {
                        type: 'string',
                        description: 'Comma-separated list of email addresses to include in the group'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional description for the group'
                    }
                },
                required: ['folder_id', 'group_name']
            }
        },
        execute: async function(scope, args) {
            try {
                const { sourceOwner, sourceId } = await SmarterMailTools._resolveContactSourcePath(scope, args.folder_id);
                const userInfo = await scope.getUserInfo();

                const groupedContacts = [];
                if (args.member_emails) {
                    const emails = args.member_emails.split(',').map(e => e.trim()).filter(Boolean);
                    for (const email of emails) {
                        groupedContacts.push({
                            type: 0,
                            emailAddress: email,
                            displayName: email,
                            addressType: "SMTP"
                        });
                    }
                }

                const payload = {
                    ContactType: 2,
                    DisplayAs: args.group_name,
                    AdditionalInfo: args.description || '',
                    GroupedContacts: groupedContacts
                };

                await scope.$http.post(`~/api/v1/contacts/contact-put/${userInfo.username}/${sourceId}`, JSON.stringify(payload));
                return { success: true, result: `Contact group '${args.group_name}' created` };
            } catch (error) {
                scope.logError('Error creating contact group:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static UpdateContactGroup = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'update_contact_group',
            description: 'Update an existing contact group (add/remove members or rename)',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the contact folder'
                    },
                    group_id: {
                        type: 'string',
                        description: 'The ID of the contact group to update'
                    },
                    add_emails: {
                        type: 'string',
                        description: 'Comma-separated list of email addresses to add to the group'
                    },
                    remove_emails: {
                        type: 'string',
                        description: 'Comma-separated list of email addresses to remove from the group'
                    },
                    new_group_name: {
                        type: 'string',
                        description: 'New name for the group (leave empty to keep current name)'
                    },
                    new_description: {
                        type: 'string',
                        description: 'New description for the group (leave empty to keep current)'
                    }
                },
                required: ['folder_id', 'group_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const { sourceOwner, sourceId } = await SmarterMailTools._resolveContactSourcePath(scope, args.folder_id);
                const userInfo = await scope.getUserInfo();

                // Fetch existing group
                const existing = await scope.$http.get(`~/api/v1/contacts/get/${sourceOwner}/${sourceId}/${args.group_id}/`);
                const group = existing.data || existing;
                if (group.contactType !== 2) {
                    return { success: false, error: 'The specified ID is not a contact group' };
                }

                let members = group.groupedContacts || [];

                // Remove specified emails
                if (args.remove_emails) {
                    const removeSet = new Set(args.remove_emails.split(',').map(e => e.trim().toLowerCase()));
                    members = members.filter(m => !removeSet.has(m.emailAddress?.toLowerCase()));
                }

                // Add new emails
                if (args.add_emails) {
                    const existingEmails = new Set(members.map(m => m.emailAddress?.toLowerCase()));
                    const newEmails = args.add_emails.split(',').map(e => e.trim()).filter(e => e && !existingEmails.has(e.toLowerCase()));
                    for (const email of newEmails) {
                        members.push({
                            type: 0,
                            emailAddress: email,
                            displayName: email,
                            addressType: "SMTP"
                        });
                    }
                }

                const payload = {
                    Id: args.group_id,
                    ContactType: 2,
                    DisplayAs: args.new_group_name || group.displayAs,
                    AdditionalInfo: args.new_description !== undefined ? args.new_description : (group.additionalInfo || ''),
                    GroupedContacts: members
                };

                await scope.$http.post(`~/api/v1/contacts/contact-put/${userInfo.username}/${sourceId}`, JSON.stringify(payload));
                return { success: true, result: `Contact group updated` };
            } catch (error) {
                scope.logError('Error updating contact group:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static DeleteContactGroup = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'delete_contact_group',
            description: 'Delete a contact group from the specified folder',
            parameters: {
                properties: {
                    folder_id: {
                        type: 'string',
                        description: 'The ID of the contact folder'
                    },
                    group_id: {
                        type: 'string',
                        description: 'The ID of the contact group to delete'
                    }
                },
                required: ['folder_id', 'group_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const { sourceOwner, sourceId } = await SmarterMailTools._resolveContactSourcePath(scope, args.folder_id);
                const deletePayload = [{ sourceOwner, sourceId, id: args.group_id }];
                await scope.$http.post('~/api/v1/contacts/delete-bulk', JSON.stringify(deletePayload));
                return { success: true, result: 'Contact group deleted' };
            } catch (error) {
                scope.logError('Error deleting contact group:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ExpandContactGroup = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'expand_contact_group',
            description: 'Expand a contact group to get all member email addresses (including nested groups)',
            parameters: {
                properties: {
                    group_id: {
                        type: 'string',
                        description: 'The ID of the contact group to expand'
                    },
                    ignore_subgroups: {
                        type: 'boolean',
                        description: 'Set to true to ignore nested groups and only return direct members (default: false)'
                    }
                },
                required: ['group_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const userInfo = await scope.getUserInfo();
                const ignoreSubgroups = args.ignore_subgroups ? 'true' : 'false';
                const result = await scope.$http.get(`~/api/v1/contacts/unpack-group/${args.group_id}/${userInfo.username}/${ignoreSubgroups}`);
                const data = result.data || result;
                const emails = data.emails || data.members || [];
                return { success: true, result: { count: emails.length, emails } };
            } catch (error) {
                scope.logError('Error expanding contact group:', error);
                return { success: false, error: error.message };
            }
        }
    };

    // ============================================================
    // FOLDER & USER TOOLS
    // ============================================================

    static ListFolderInfoByType = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'list_folder_info_by_type',
            description: 'List folder information of folders by type',
            parameters: {
                properties: {
                    type: {
                        type: 'number',
                        description: 'The type of folders to list: 1=email, 2=calendars/tasks, 3=contacts, 4=notes'
                    }
                },
                required: ['type']
            }
        },
        execute: async function(scope, args) {
            try {
                const endpoints = {
                    1: "~/api/v1/folders/list-email-folders",
                    2: "~/api/v1/calendars/sources",
                    3: "~/api/v1/contacts/sources",
                    4: "~/api/v1/notes/sources"
                };

                const endpoint = endpoints[args.type];
                if (!endpoint) {
                    return { success: false, error: 'Invalid type. Use 1=email, 2=calendars/tasks, 3=contacts, 4=notes' };
                }

                const result = await scope.$http.get(endpoint);
                return { success: true, result: result.data || result };
            } catch (error) {
                scope.logError('Error listing folders:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetUserData = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_user_data',
            description: 'Get current user profile and settings data'
        },
        execute: async function(scope, args) {
            try {
                const result = await scope.$http.get("~/api/v1/settings/user-settings");
                return { success: true, result: result.data || result };
            } catch (error) {
                scope.logError('Error getting user data:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SearchItems = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'search_items',
            description: 'Search for items across the system (mail, notes, tasks, contacts, events)',
            parameters: {
                properties: {
                    section: {
                        type: 'string',
                        description: "Section to search: 'Everywhere', 'Email', 'Notes', 'Contacts', 'Calendar', 'Tasks'"
                    },
                    search_query: {
                        type: 'string',
                        description: 'The search query'
                    },
                    or: {
                        type: 'boolean',
                        description: 'Use OR logic for multiple search terms (default: false = AND logic)'
                    },
                    max_emails_to_return: {
                        type: 'number',
                        description: 'Maximum number of email results to return (default: 250)'
                    }
                },
                required: ['section', 'search_query']
            }
        },
        execute: async function(scope, args) {
            try {
                const sectionMap = {
                    'everywhere': 0, 'email': 1, 'notes': 2,
                    'contacts': 3, 'calendar': 4, 'tasks': 5
                };
                const sectionValue = sectionMap[args.section.toLowerCase()];
                if (sectionValue === undefined) {
                    return { success: false, error: "Invalid section. Use: Everywhere, Email, Notes, Contacts, Calendar, Tasks" };
                }

                const payload = {
                    section: sectionValue,
                    searchQuery: args.search_query,
                    or: args.or || false,
                    maxEmailsToReturn: args.max_emails_to_return || 250,
                    searchCriteriaMap: {}
                };

                const result = await scope.$http.post("~/api/v1/settings/advanced-search", payload);
                return { success: true, result: result.data || result };
            } catch (error) {
                scope.logError('Error searching items:', error);
                return { success: false, error: error.message };
            }
        }
    };

    // ============================================================
    // SETTINGS TOOLS - Blocked/Trusted Senders
    // ============================================================

    static BlockSenders = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'block_senders',
            description: 'Block email senders to prevent delivery. Accepts email addresses or domains.',
            parameters: {
                properties: {
                    senders: {
                        type: 'string',
                        description: "Comma-separated email addresses or domains to block (e.g., 'spam@example.com, baddomain.com')"
                    }
                },
                required: ['senders']
            }
        },
        execute: async function(scope, args) {
            try {
                const senderList = args.senders.split(',').map(s => s.trim()).filter(Boolean);
                if (senderList.length === 0) return { success: false, error: 'No valid senders provided' };

                const blockedSenders = {};
                for (const sender of senderList) {
                    blockedSenders[sender] = [];
                }

                await scope.$http.post("~/api/v1/settings/block-senders", { blockedSenders, isSender: true });
                return { success: true, result: { blockedCount: senderList.length, blocked: senderList } };
            } catch (error) {
                scope.logError('Error blocking senders:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static UnblockSenders = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'unblock_senders',
            description: 'Unblock previously blocked senders. Accepts email addresses or domains.',
            parameters: {
                properties: {
                    senders: {
                        type: 'string',
                        description: 'Comma-separated email addresses or domains to unblock'
                    }
                },
                required: ['senders']
            }
        },
        execute: async function(scope, args) {
            try {
                const senderList = args.senders.split(',').map(s => s.trim()).filter(Boolean);
                if (senderList.length === 0) return { success: false, error: 'No valid senders provided' };

                const blockedSenders = {};
                for (const sender of senderList) {
                    blockedSenders[sender] = [];
                }

                const userInfo = await scope.getUserInfo();
                await scope.$http.post("~/api/v1/settings/unblock-senders", {
                    blockedSenders,
                    sourceOwner: userInfo.emailAddress,
                    sourceFolder: "Inbox",
                    isSender: true
                });
                return { success: true, result: { unblockedCount: senderList.length, unblocked: senderList } };
            } catch (error) {
                scope.logError('Error unblocking senders:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CheckSenderBlocked = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'check_sender_blocked',
            description: 'Check if a sender email address is blocked',
            parameters: {
                properties: {
                    email: {
                        type: 'string',
                        description: 'The email address to check'
                    }
                },
                required: ['email']
            }
        },
        execute: async function(scope, args) {
            try {
                const result = await scope.$http.post("~/api/v1/settings/sender-blocked", { email: args.email.trim() });
                const data = result.data || result;
                const isBlocked = data.result === true || data.isBlocked === true;
                return { success: true, result: { email: args.email.trim(), isBlocked } };
            } catch (error) {
                scope.logError('Error checking blocked sender:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SetTrustedSenders = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'set_trusted_senders',
            description: 'Set trusted senders (whitelist) to bypass spam filtering. Accepts email addresses and/or domains.',
            parameters: {
                properties: {
                    emails: {
                        type: 'string',
                        description: "Comma-separated trusted email addresses (e.g., 'friend@example.com, colleague@work.com')"
                    },
                    domains: {
                        type: 'string',
                        description: "Comma-separated trusted domains (e.g., 'trusted.com, company.org')"
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const emailList = args.emails ? args.emails.split(',').map(e => e.trim()).filter(Boolean) : [];
                const domainList = args.domains ? args.domains.split(',').map(d => d.trim()).filter(Boolean) : [];
                if (emailList.length === 0 && domainList.length === 0) {
                    return { success: false, error: 'No emails or domains provided' };
                }

                await scope.$http.post("~/api/v1/settings/whitelist", { domains: domainList, emails: emailList });
                return { success: true, result: { trustedEmails: emailList, trustedDomains: domainList } };
            } catch (error) {
                scope.logError('Error setting trusted senders:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CheckSenderTrusted = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'check_sender_trusted',
            description: 'Check if a sender email address is trusted (whitelisted)',
            parameters: {
                properties: {
                    email: {
                        type: 'string',
                        description: 'The email address to check'
                    }
                },
                required: ['email']
            }
        },
        execute: async function(scope, args) {
            try {
                const result = await scope.$http.post("~/api/v1/settings/sender-trusted", { email: args.email.trim() });
                const data = result.data || result;
                return { success: true, result: {
                    email: args.email.trim(),
                    isTrusted: data.isTrusted || false,
                    isBypassed: data.isBypassed || false,
                    trustSource: data.trustSource || null
                }};
            } catch (error) {
                scope.logError('Error checking trusted sender:', error);
                return { success: false, error: error.message };
            }
        }
    };

    // ============================================================
    // SETTINGS TOOLS - Content Filters
    // ============================================================

    static _getFieldTypeName = (fieldType) => {
        const names = {
            0: 'FromAddress', 1: 'FromDomain', 2: 'FromTrustedSender', 3: 'WordsInSubject',
            4: 'WordsInBody', 5: 'WordsInSubjectOrBody', 6: 'WordsInFrom', 7: 'WordsInTo',
            8: 'WordsInHeaders', 9: 'WordsInMessage', 10: 'ToAddress', 11: 'ToDomain',
            12: 'ToMe', 13: 'MyNameInTo', 14: 'MyNameNotInTo', 15: 'MyNameInToOrCC',
            16: 'HasAttachments', 17: 'AttachmentFilename', 18: 'AttachmentExtension',
            19: 'AttachmentSize', 20: 'PriorityHigh', 21: 'PriorityNormal', 22: 'PriorityLow'
        };
        return names[fieldType] || `Unknown(${fieldType})`;
    };

    static _getComparisonTypeName = (filterType) => {
        const names = { 0: 'Equals', 1: 'DoesntEqual', 2: 'Contains', 3: 'DoesntContain' };
        return names[filterType] || `Unknown(${filterType})`;
    };

    static _getActionTypeName = (actionType) => {
        const names = {
            0: 'NoAction', 1: 'Delete', 3: 'Bounce', 4: 'MoveToFolder', 5: 'AddHeader',
            6: 'PrefixSubject', 7: 'Forward', 8: 'MarkAsRead', 9: 'SetPriority', 10: 'FollowUp'
        };
        return names[actionType] || `Unknown(${actionType})`;
    };

    static _parseContentFilterCondition = (condition) => {
        const input = condition.trim().toLowerCase();

        if (input === 'has attachments' || input === 'has attachment') {
            return { fieldType: 16, filterType: 0, searchArguments: [] };
        }

        const patterns = [
            { prefix: 'attachment extension', fieldType: 18 },
            { prefix: 'attachment filename', fieldType: 17 },
            { prefix: 'attachment name', fieldType: 17 },
            { prefix: 'from domain', fieldType: 1 },
            { prefix: 'domain', fieldType: 1 },
            { prefix: 'from', fieldType: 0 },
            { prefix: 'subject', fieldType: 3 },
            { prefix: 'body', fieldType: 4 },
            { prefix: 'to address', fieldType: 10 },
            { prefix: 'to domain', fieldType: 11 },
            { prefix: 'to', fieldType: 7 }
        ];

        for (const pattern of patterns) {
            if (input.startsWith(pattern.prefix + ' ')) {
                const remainder = input.slice(pattern.prefix.length + 1).trim();
                const cv = SmarterMailTools._parseComparisonAndValue(remainder);
                if (!cv) return { error: `Cannot parse condition: '${condition}'` };

                let fieldType = pattern.fieldType;
                // "to equals/is" -> ToAddress (10), "to contains" -> WordsInTo (7)
                if (pattern.prefix === 'to' && (cv.filterType === 0 || cv.filterType === 1)) {
                    fieldType = 10;
                }

                return { fieldType, filterType: cv.filterType, searchArguments: [cv.value] };
            }
        }

        return { error: `Cannot parse condition: '${condition}'` };
    };

    static _parseComparisonAndValue = (text) => {
        const negations = [
            { phrases: ["does not contain", "doesn't contain", "doesnt contain", "not containing"], filterType: 3 },
            { phrases: ["does not equal", "doesn't equal", "doesnt equal", "is not", "isn't", "isnt"], filterType: 1 }
        ];
        for (const neg of negations) {
            for (const phrase of neg.phrases) {
                if (text.startsWith(phrase + ' ')) {
                    return { filterType: neg.filterType, value: text.slice(phrase.length + 1).trim() };
                }
            }
        }

        const positives = [
            { phrases: ["contains", "containing", "has"], filterType: 2 },
            { phrases: ["equals", "equal to", "is", "="], filterType: 0 }
        ];
        for (const pos of positives) {
            for (const phrase of pos.phrases) {
                if (text.startsWith(phrase + ' ')) {
                    return { filterType: pos.filterType, value: text.slice(phrase.length + 1).trim() };
                }
            }
        }
        return null;
    };

    static _parseContentFilterAction = (action) => {
        const input = action.trim().toLowerCase();

        if (input === 'delete') return { actionType: 1, argument: '' };
        if (input === 'mark as read' || input === 'mark read') return { actionType: 8, argument: '' };
        if (input === 'flag' || input === 'follow up' || input === 'flag for follow up') return { actionType: 10, argument: '' };

        const actionPatterns = [
            { prefixes: ['move to', 'move to folder'], actionType: 4 },
            { prefixes: ['forward to', 'forward'], actionType: 7 },
            { prefixes: ['prefix subject with', 'prefix subject'], actionType: 6 },
            { prefixes: ['add header', 'set header'], actionType: 5 },
            { prefixes: ['set priority'], actionType: 9 }
        ];

        for (const pattern of actionPatterns) {
            for (const prefix of pattern.prefixes) {
                if (input.startsWith(prefix + ' ')) {
                    let argument = action.trim().slice(prefix.length + 1).trim();
                    if (pattern.actionType === 9) {
                        const priorityMap = { 'high': '1', 'normal': '3', 'low': '5' };
                        argument = priorityMap[argument.toLowerCase()] || argument;
                    }
                    return { actionType: pattern.actionType, argument };
                }
            }
        }

        return { error: `Cannot parse action: '${action}'` };
    };

    static GetContentFilters = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'get_content_filters',
            description: 'Get all content filters (inbox rules). Returns filter groups with their conditions and actions.'
        },
        execute: async function(scope, args) {
            try {
                const result = await scope.$http.get("~/api/v1/settings/content-filter-groups");
                const data = result.data || result;
                const filterGroups = data.contentFilterGroups || [];

                const filters = filterGroups.map(group => {
                    const conditions = (group.filters || []).map(f => ({
                        fieldType: f.fieldType,
                        fieldTypeName: SmarterMailTools._getFieldTypeName(f.fieldType),
                        filterType: f.filterType,
                        filterTypeName: SmarterMailTools._getComparisonTypeName(f.filterType),
                        searchArguments: f.searchArguments || []
                    }));

                    const actions = (group.actions || []).map(a => ({
                        actionType: a.actionType,
                        actionTypeName: SmarterMailTools._getActionTypeName(a.actionType),
                        argument: a.argument || ''
                    }));

                    return {
                        id: group.id,
                        title: group.title,
                        matchType: group.matchType,
                        matchTypeName: group.matchType === 0 ? 'And' : 'Or',
                        isEnabled: !group.disabled,
                        conditions,
                        actions
                    };
                });

                return { success: true, result: { filterCount: filters.length, filters } };
            } catch (error) {
                scope.logError('Error getting content filters:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CreateContentFilter = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'create_content_filter',
            description: "Create a content filter (inbox rule). Conditions JSON: [{\"fieldType\": 0, \"filterType\": 2, \"searchArguments\": [\"value\"]}]. Actions JSON: [{\"actionType\": 4, \"argument\": \"FolderName\"}]. fieldType: 0=FromAddress, 1=FromDomain, 3=WordsInSubject, 4=WordsInBody, 10=ToAddress, 16=HasAttachments. filterType: 0=Equals, 1=DoesntEqual, 2=Contains, 3=DoesntContain. actionType: 1=Delete, 4=MoveToFolder, 5=AddHeader, 6=PrefixSubject, 7=Forward, 8=MarkAsRead.",
            parameters: {
                properties: {
                    title: {
                        type: 'string',
                        description: 'Filter name/title'
                    },
                    match_type: {
                        type: 'string',
                        description: "Match type: 'And' (all conditions must match) or 'Or' (any condition matches)"
                    },
                    conditions: {
                        type: 'string',
                        description: 'JSON array of filter conditions'
                    },
                    actions: {
                        type: 'string',
                        description: 'JSON array of filter actions'
                    }
                },
                required: ['title', 'conditions', 'actions']
            }
        },
        execute: async function(scope, args) {
            try {
                const matchTypeValue = args.match_type?.toLowerCase() === 'or' ? 1 : 0;

                let conditionsList, actionsList;
                try { conditionsList = JSON.parse(args.conditions); } catch { return { success: false, error: 'Invalid conditions JSON' }; }
                try { actionsList = JSON.parse(args.actions); } catch { return { success: false, error: 'Invalid actions JSON' }; }

                if (!conditionsList.length) return { success: false, error: 'At least one condition is required' };
                if (!actionsList.length) return { success: false, error: 'At least one action is required' };

                const payload = {
                    toAdd: [{
                        title: args.title,
                        matchType: matchTypeValue,
                        filters: conditionsList,
                        actions: actionsList
                    }]
                };

                const result = await scope.$http.post("~/api/v1/settings/content-filter-groups", payload);
                return { success: true, result: { created: { title: args.title, matchType: matchTypeValue === 0 ? 'And' : 'Or' }, response: result.data || result } };
            } catch (error) {
                scope.logError('Error creating content filter:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CreateContentFilterSimple = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'create_content_filter_simple',
            description: "Create a content filter using plain English. Conditions (separate with semicolons): 'from contains newsletter@', 'subject contains invoice', 'has attachments', 'to contains sales@', 'from domain is example.com'. Actions: 'move to Newsletters', 'delete', 'mark as read', 'forward to bob@example.com', 'prefix subject with [NEWS]', 'flag'.",
            parameters: {
                properties: {
                    name: {
                        type: 'string',
                        description: 'Filter name/title'
                    },
                    when: {
                        type: 'string',
                        description: 'Condition(s) in plain English. Separate multiple conditions with semicolons.'
                    },
                    then: {
                        type: 'string',
                        description: 'Action(s) in plain English. Separate multiple actions with semicolons.'
                    },
                    match_all: {
                        type: 'boolean',
                        description: 'Whether all conditions must match (true) or any condition can match (false). Default: true'
                    }
                },
                required: ['name', 'when', 'then']
            }
        },
        execute: async function(scope, args) {
            try {
                // Parse conditions
                const conditionStrings = args.when.split(';').map(s => s.trim()).filter(Boolean);
                const parsedConditions = [];
                for (const condStr of conditionStrings) {
                    const result = SmarterMailTools._parseContentFilterCondition(condStr);
                    if (result.error) return { success: false, error: result.error, hint: 'Use create_content_filter for advanced rules with JSON format.' };
                    parsedConditions.push({
                        fieldType: result.fieldType,
                        filterType: result.filterType,
                        searchArguments: result.searchArguments
                    });
                }

                // Parse actions
                const actionStrings = args.then.split(';').map(s => s.trim()).filter(Boolean);
                const parsedActions = [];
                for (const actStr of actionStrings) {
                    const result = SmarterMailTools._parseContentFilterAction(actStr);
                    if (result.error) return { success: false, error: result.error, hint: 'Use create_content_filter for advanced rules with JSON format.' };
                    parsedActions.push({
                        actionType: result.actionType,
                        argument: result.argument
                    });
                }

                const matchAll = args.match_all !== false;
                const payload = {
                    toAdd: [{
                        title: args.name,
                        matchType: matchAll ? 0 : 1,
                        filters: parsedConditions,
                        actions: parsedActions
                    }]
                };

                const result = await scope.$http.post("~/api/v1/settings/content-filter-groups", payload);
                return { success: true, result: { created: { title: args.name, matchType: matchAll ? 'And' : 'Or', conditions: conditionStrings.length, actions: actionStrings.length }, response: result.data || result } };
            } catch (error) {
                scope.logError('Error creating content filter:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static UpdateContentFilter = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'update_content_filter',
            description: 'Update an existing content filter. Only provided fields will be updated.',
            parameters: {
                properties: {
                    filter_id: {
                        type: 'string',
                        description: 'Filter ID to update (use get_content_filters to find IDs)'
                    },
                    title: {
                        type: 'string',
                        description: 'New filter name/title (optional)'
                    },
                    match_type: {
                        type: 'string',
                        description: "New match type: 'And' or 'Or' (optional)"
                    },
                    conditions: {
                        type: 'string',
                        description: 'New conditions JSON array (optional)'
                    },
                    actions: {
                        type: 'string',
                        description: 'New actions JSON array (optional)'
                    }
                },
                required: ['filter_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const filterId = parseInt(args.filter_id);
                if (isNaN(filterId)) return { success: false, error: 'Valid numeric filter ID is required' };

                // Fetch existing filters
                const existing = await scope.$http.get("~/api/v1/settings/content-filter-groups");
                const data = existing.data || existing;
                const filterGroups = data.contentFilterGroups || [];
                const existingFilter = filterGroups.find(g => g.id === filterId);
                if (!existingFilter) return { success: false, error: `Filter with ID ${args.filter_id} not found` };

                // Build updated filter
                const updatedFilter = {
                    id: filterId,
                    title: args.title || existingFilter.title,
                    matchType: args.match_type ? (args.match_type.toLowerCase() === 'or' ? 1 : 0) : existingFilter.matchType,
                    filters: args.conditions ? JSON.parse(args.conditions) : existingFilter.filters,
                    actions: args.actions ? JSON.parse(args.actions) : existingFilter.actions
                };

                const result = await scope.$http.post("~/api/v1/settings/content-filter-groups", {
                    contentFilterGroups: [updatedFilter]
                });
                return { success: true, result: { updated: { id: filterId, title: updatedFilter.title }, response: result.data || result } };
            } catch (error) {
                scope.logError('Error updating content filter:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static DeleteContentFilters = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'delete_content_filters',
            description: 'Delete content filters by ID',
            parameters: {
                properties: {
                    filter_ids: {
                        type: 'string',
                        description: 'Comma-separated filter IDs to delete'
                    }
                },
                required: ['filter_ids']
            }
        },
        execute: async function(scope, args) {
            try {
                const idList = args.filter_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
                if (idList.length === 0) return { success: false, error: 'No valid filter IDs provided' };

                const result = await scope.$http.post("~/api/v1/settings/content-filter-groups", { toRemove: idList });
                return { success: true, result: { deletedCount: idList.length, deletedIds: idList, response: result.data || result } };
            } catch (error) {
                scope.logError('Error deleting content filters:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static RunContentFilters = {
        context: TOOL_CONTEXT.PAGE_SCOPE,
        function: {
            name: 'run_content_filters',
            description: 'Run content filters against a folder to process existing emails',
            parameters: {
                properties: {
                    folder: {
                        type: 'string',
                        description: "Folder path to run filters on (e.g., 'Inbox')"
                    },
                    filter_ids: {
                        type: 'string',
                        description: 'Optional: comma-separated filter IDs to run. If empty, runs all enabled filters.'
                    }
                },
                required: ['folder']
            }
        },
        execute: async function(scope, args) {
            try {
                const payload = { folder: args.folder.trim() };
                if (args.filter_ids) {
                    const idList = args.filter_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
                    if (idList.length > 0) payload.toRun = idList;
                }

                const result = await scope.$http.post("~/api/v1/settings/run-content-filters", payload);
                return { success: true, result: { folder: args.folder.trim(), response: result.data || result } };
            } catch (error) {
                scope.logError('Error running content filters:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if (typeof window !== 'undefined') {
    (window.sbaiTools ??= {}).SmarterMailTools = SmarterMailTools;
}

export { SmarterMailTools };