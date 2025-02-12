class RocketChatTools {
    static name = "RocketChatTools";

    static _CarbonBarPageLoadFilter = (window) => {
        // Match Rocket.Chat URLs - both cloud and self-hosted instances
        return window.location.hostname.includes('rocket.chat') || 
               document.querySelector('meta[name="application-name"][content="Rocket.Chat"]') !== null;
    }

    static ReadChannel = {
        function: {
            name: 'read_channel',
            description: 'Read messages from a Rocket.Chat channel',
            parameters: {
                properties: {
                    channel_name: {
                        type: 'string',
                        description: 'Name of the channel to read'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of messages to return (default: 50)'
                    },
                    include_threads: {
                        type: 'boolean',
                        description: 'Whether to include thread messages (default: false)'
                    }
                },
                required: ['channel_name']
            }
        },
        execute: async function(scope, args) {
            try {
                const limit = args.limit || 50;
                const includeThreads = args.include_threads || false;

                // Get the Meteor instance from window
                const Meteor = window.Meteor;
                if (!Meteor) {
                    throw new Error('Rocket.Chat Meteor instance not found');
                }

                // Get room ID from channel name
                const room = await new Promise((resolve, reject) => {
                    Meteor.call('getRoomByName', args.channel_name, (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    });
                });

                if (!room) {
                    throw new Error(`Channel "${args.channel_name}" not found`);
                }

                // Get messages
                const messages = await new Promise((resolve, reject) => {
                    Meteor.call('loadHistory', room._id, null, limit, null, (error, result) => {
                        if (error) reject(error);
                        else resolve(result.messages);
                    });
                });

                // Format messages
                let formattedMessages = messages.map(msg => ({
                    id: msg._id,
                    text: msg.msg,
                    sender: msg.u.username,
                    timestamp: msg.ts,
                    attachments: msg.attachments,
                    reactions: msg.reactions,
                    threadCount: msg.tcount || 0,
                    threadMainMessage: msg.tmid ? true : false
                }));

                // Get thread messages if requested
                if (includeThreads) {
                    const threadMainMessages = formattedMessages.filter(msg => msg.threadCount > 0);
                    for (const mainMsg of threadMainMessages) {
                        const threadMessages = await new Promise((resolve, reject) => {
                            Meteor.call('getThreadMessages', mainMsg.id, (error, result) => {
                                if (error) reject(error);
                                else resolve(result);
                            });
                        });

                        mainMsg.thread = threadMessages.map(msg => ({
                            id: msg._id,
                            text: msg.msg,
                            sender: msg.u.username,
                            timestamp: msg.ts,
                            attachments: msg.attachments,
                            reactions: msg.reactions
                        }));
                    }
                }

                return { 
                    success: true, 
                    result: {
                        channel: {
                            id: room._id,
                            name: room.name,
                            type: room.t,
                            topic: room.topic,
                            memberCount: room.usersCount
                        },
                        messages: formattedMessages
                    }
                };
            } catch (error) {
                scope.logError('Error reading channel:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['RocketChatTools'] = RocketChatTools;
} else {
    window.sbaiTools = {
        'RocketChatTools': RocketChatTools
    };
}

export { RocketChatTools }; 