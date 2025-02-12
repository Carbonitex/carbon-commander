
//TODO: Reduce size of SM content returns

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
          } catch (error) {
            scope.logError('Error getting user info:', error);
            systemPrompt += '. Unable to get user info.';
          }

        return systemPrompt;
    }


    static GetHelp = {
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
        function: {
            name: 'read_emails_fast',
            description: 'Get the emails including only the subject and metadata for a given folder',
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
                        description: 'Whether to include attachments in the email data (default = false)'
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
        function: {
            name: "get_calendar_events",
            description: "Get calendar events for a given date range",
            parameters: {
                properties: {
                    start_date: {
                        type: 'string',
                        description: 'The start date of the range to get events for (YYYY-MM-DDTHH:mm:ss)'
                    },
                    end_date:{ 
                        type: 'string',
                        description: 'The end date of the range to get events for (YYYY-MM-DDTHH:mm:ss)'
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
            const calendarId = args.calendar_id || (await cs.getCalendars()).filter(x=> x.isPrimary)[0].id;

            const calendar = (await cs.getCalendars()).filter(x=> x.id == calendarId)[0];
            
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
        function: {
            name: 'get_notes',
            description: 'Get notes sorted by most recently edited',
            parameters: {
                properties: {
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
        function: {
            name: "get_tasks",
            description: "Get tasks sorted by most recently edited",
            parameters: {
                properties: {
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
        function: {
            name: 'get_contacts',
            description: 'Get contacts sorted by most recently contacted',
            parameters: {
                properties: {
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
        function: {
            name: 'new_or_update_contact',
            description: 'Create a new contact or update an existing one',
            parameters: {
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the contact'
                    },
                    email: {
                        type: 'string',
                        description: 'The email address of the contact'
                    },
                    phone: {
                        type: 'string',
                        description: 'The phone number of the contact'
                    },
                    address: {
                        type: 'string',
                        description: 'The address of the contact'
                    },
                    quick_notes: {
                        type: 'string',
                        description: 'Quick notes about the contact'
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
            const contactsService = scope.getService('coreDataContacts');
            
            // Load sources first
            await contactsService.ensureSourcesLoadedPromise();
            await contactsService.ensureContactsLoadedPromise();
            const sources = contactsService.getSources();
            
            // Find primary source
            const primarySource = sources.find(s => s.isPrimary);
            if (!primarySource) {
                throw new Error('No primary contacts source found');
            }

            const contact = {
                id: args.contact_id || null,
                displayAs: args.name,
                email: args.email,
                phoneNumberList: args.phone ? [{ number: args.phone }] : [],
                busStreet: args.address,
                additionalInfo: args.quick_notes,
                source: primarySource,
                sourceOwner: primarySource.ownerUsername,
                sourceId: primarySource.itemID
            };

            if (args.contact_id) {
                // Update existing contact
                await contactsService.editContact(contact);
            } else {
                // Create new contact
                await contactsService.addContact(contact);
            }

            return { success: true, result: `Contact ${args.name} saved` };
        }
    };

    static NewOrUpdateTask = {
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
                    calendar_id: {
                        type: 'string',
                        description: 'The id of the calendar to add/update the event to (default is primary calendar)'
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
            let calendar = args.calendar_id ? calendars.find(x=> x.id == args.calendar_id) : calendars.find(x=> x.isPrimary);

            if (!calendar) {
                responseContext = `Calendar (${args.calendar_id}) not found, using primary calendar`;
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
} 

(window.sbaiTools ??= {}).SmarterMailTools = SmarterMailTools;

export { SmarterMailTools };