#import "SSHLocalPortForward.h"

#import <arpa/inet.h>
#import <errno.h>
#import <fcntl.h>
#import <netinet/in.h>
#import <sys/select.h>
#import <sys/socket.h>
#import <unistd.h>
#import <string.h>

static int OVWaitSocket(int socketFD, LIBSSH2_SESSION *session) {
    struct timeval timeout;
    fd_set fd;
    fd_set *writefd = NULL;
    fd_set *readfd = NULL;

    timeout.tv_sec = 0;
    timeout.tv_usec = 500000;

    FD_ZERO(&fd);
    FD_SET(socketFD, &fd);

    int dir = libssh2_session_block_directions(session);
    if (dir & LIBSSH2_SESSION_BLOCK_INBOUND) {
        readfd = &fd;
    }
    if (dir & LIBSSH2_SESSION_BLOCK_OUTBOUND) {
        writefd = &fd;
    }

    return select(socketFD + 1, readfd, writefd, NULL, &timeout);
}

@interface SSHLocalPortForwardConnection : NSObject
@property (nonatomic, assign) int localSocket;
@property (nonatomic, assign) LIBSSH2_CHANNEL *channel;
@property (atomic, assign) BOOL stopped;
@end

@implementation SSHLocalPortForwardConnection

- (instancetype)init {
    if ((self = [super init])) {
        _localSocket = -1;
        _channel = NULL;
        _stopped = NO;
    }
    return self;
}

@end

@interface SSHLocalPortForward ()
@property (nonatomic, weak) SSHClient *client;
@property (nonatomic, copy, readwrite) NSString *tunnelId;
@property (nonatomic, copy, readwrite) NSString *localHost;
@property (nonatomic, assign, readwrite) NSInteger localPort;
@property (nonatomic, copy, readwrite) NSString *remoteHost;
@property (nonatomic, assign, readwrite) NSInteger remotePort;
@property (nonatomic, assign) int listenerSocket;
@property (nonatomic, assign) BOOL stopped;
@property (nonatomic, strong) NSMutableSet<SSHLocalPortForwardConnection *> *connections;
@property (nonatomic, strong) dispatch_queue_t queue;
#if OS_OBJECT_USE_OBJC
@property (nonatomic, strong) dispatch_source_t acceptSource;
#else
@property (nonatomic, assign) dispatch_source_t acceptSource;
#endif
@end

@implementation SSHLocalPortForward

- (instancetype)initWithClient:(SSHClient *)client
                    remoteHost:(NSString *)remoteHost
                    remotePort:(NSInteger)remotePort
                     localHost:(NSString *)localHost
                     localPort:(NSInteger)localPort {
    if ((self = [super init])) {
        _client = client;
        _remoteHost = [remoteHost copy];
        _remotePort = remotePort;
        _localHost = [localHost copy];
        _localPort = localPort;
        _listenerSocket = -1;
        _stopped = NO;
        _connections = [NSMutableSet new];
        _queue = dispatch_queue_create("reactnative.sshclient.forward", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (BOOL)start:(NSError **)error {
    if (!self.client || !self.client._session || !self.client._session.isConnected || !self.client._session.isAuthorized) {
        if (error) {
            *error = [NSError errorWithDomain:@"RNSSHClient"
                                         code:1
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Session not connected" }];
        }
        return NO;
    }

    int listener = socket(AF_INET, SOCK_STREAM, 0);
    if (listener < 0) {
        if (error) {
            *error = [NSError errorWithDomain:@"RNSSHClient"
                                         code:2
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Failed to create local listener socket" }];
        }
        return NO;
    }

    int yes = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
    fcntl(listener, F_SETFL, O_NONBLOCK);

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_len = sizeof(addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)self.localPort);

    const char *bindHost = [self.localHost UTF8String];
    if (inet_pton(AF_INET, bindHost, &addr.sin_addr) != 1) {
        close(listener);
        if (error) {
            *error = [NSError errorWithDomain:@"RNSSHClient"
                                         code:3
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Invalid local bind host" }];
        }
        return NO;
    }

    if (bind(listener, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        close(listener);
        if (error) {
            *error = [NSError errorWithDomain:@"RNSSHClient"
                                         code:4
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Failed to bind local listener socket" }];
        }
        return NO;
    }

    if (listen(listener, 16) != 0) {
        close(listener);
        if (error) {
            *error = [NSError errorWithDomain:@"RNSSHClient"
                                         code:5
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Failed to listen on local tunnel socket" }];
        }
        return NO;
    }

    struct sockaddr_in actualAddr;
    socklen_t actualLen = sizeof(actualAddr);
    if (getsockname(listener, (struct sockaddr *)&actualAddr, &actualLen) == 0) {
        self.localPort = ntohs(actualAddr.sin_port);
    }
    self.listenerSocket = listener;
    self.tunnelId = [NSString stringWithFormat:@"%@:%ld->%@:%ld",
                     self.localHost,
                     (long)self.localPort,
                     self.remoteHost,
                     (long)self.remotePort];

    dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, (uintptr_t)listener, 0, self.queue);
    self.acceptSource = source;

    __weak typeof(self) weakSelf = self;
    dispatch_source_set_event_handler(source, ^{
        [weakSelf acceptConnections];
    });
    dispatch_source_set_cancel_handler(source, ^{
        if (weakSelf.listenerSocket >= 0) {
            close(weakSelf.listenerSocket);
            weakSelf.listenerSocket = -1;
        }
    });
    dispatch_resume(source);

    return YES;
}

- (void)acceptConnections {
    if (self.stopped || self.listenerSocket < 0) {
        return;
    }

    while (!self.stopped) {
        int localSocket = accept(self.listenerSocket, NULL, NULL);
        if (localSocket < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                break;
            }
            return;
        }

        fcntl(localSocket, F_SETFL, O_NONBLOCK);
        SSHLocalPortForwardConnection *connection = [SSHLocalPortForwardConnection new];
        connection.localSocket = localSocket;

        @synchronized (self.connections) {
            [self.connections addObject:connection];
        }

        dispatch_async(self.queue, ^{
            [self bridgeConnection:connection];
        });
    }
}

- (BOOL)writeChannel:(LIBSSH2_CHANNEL *)channel
                data:(const uint8_t *)data
              length:(size_t)length
           sshSocket:(int)sshSocket
             session:(LIBSSH2_SESSION *)session {
    size_t offset = 0;
    while (offset < length && !self.stopped) {
        ssize_t rc = libssh2_channel_write_ex(channel, 0, (const char *)data + offset, length - offset);
        if (rc > 0) {
            offset += (size_t)rc;
            continue;
        }
        if (rc == LIBSSH2_ERROR_EAGAIN) {
            if (sshSocket >= 0) {
                OVWaitSocket(sshSocket, session);
            } else {
                usleep(10000);
            }
            continue;
        }
        return NO;
    }
    return offset == length;
}

- (BOOL)writeSocket:(int)localSocket data:(const uint8_t *)data length:(size_t)length {
    size_t offset = 0;
    while (offset < length && !self.stopped) {
        ssize_t sent = send(localSocket, data + offset, length - offset, 0);
        if (sent > 0) {
            offset += (size_t)sent;
            continue;
        }
        if (sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) {
            usleep(10000);
            continue;
        }
        return NO;
    }
    return offset == length;
}

- (void)cleanupConnection:(SSHLocalPortForwardConnection *)connection {
    if (connection.channel != NULL) {
        libssh2_channel_send_eof(connection.channel);
        libssh2_channel_close(connection.channel);
        libssh2_channel_free(connection.channel);
        connection.channel = NULL;
    }
    if (connection.localSocket >= 0) {
        shutdown(connection.localSocket, SHUT_RDWR);
        close(connection.localSocket);
        connection.localSocket = -1;
    }
    @synchronized (self.connections) {
        [self.connections removeObject:connection];
    }
}

- (void)bridgeConnection:(SSHLocalPortForwardConnection *)connection {
    NMSSHSession *session = self.client._session;
    if (!session || !session.isConnected || !session.isAuthorized || !session.rawSession) {
        [self cleanupConnection:connection];
        return;
    }

    CFSocketRef socketRef = [session socket];
    int sshSocket = socketRef ? CFSocketGetNative(socketRef) : -1;

    libssh2_session_set_blocking(session.rawSession, 0);
    LIBSSH2_CHANNEL *channel = NULL;
    while (!self.stopped && !connection.stopped) {
        channel = libssh2_channel_direct_tcpip_ex(
            session.rawSession,
            [self.remoteHost UTF8String],
            (int)self.remotePort,
            [self.localHost UTF8String],
            (int)self.localPort
        );
        if (channel != NULL) {
            break;
        }
        if (libssh2_session_last_errno(session.rawSession) != LIBSSH2_ERROR_EAGAIN) {
            [self cleanupConnection:connection];
            libssh2_session_set_blocking(session.rawSession, 1);
            return;
        }
        if (sshSocket >= 0) {
            OVWaitSocket(sshSocket, session.rawSession);
        } else {
            usleep(10000);
        }
    }

    if (channel == NULL) {
        [self cleanupConnection:connection];
        libssh2_session_set_blocking(session.rawSession, 1);
        return;
    }

    connection.channel = channel;

    uint8_t buffer[16384];
    while (!self.stopped && !connection.stopped) {
        BOOL didWork = NO;

        ssize_t localRead = recv(connection.localSocket, buffer, sizeof(buffer), 0);
        if (localRead > 0) {
            didWork = YES;
            if (![self writeChannel:channel data:buffer length:(size_t)localRead sshSocket:sshSocket session:session.rawSession]) {
                break;
            }
        } else if (localRead == 0) {
            break;
        } else if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
            break;
        }

        while (!self.stopped && !connection.stopped) {
            ssize_t remoteRead = libssh2_channel_read_ex(channel, 0, (char *)buffer, sizeof(buffer));
            if (remoteRead > 0) {
                didWork = YES;
                if (![self writeSocket:connection.localSocket data:buffer length:(size_t)remoteRead]) {
                    connection.stopped = YES;
                    break;
                }
                continue;
            }
            if (remoteRead == LIBSSH2_ERROR_EAGAIN || remoteRead == 0) {
                break;
            }
            connection.stopped = YES;
            break;
        }

        if (libssh2_channel_eof(channel)) {
            break;
        }

        if (!didWork) {
            usleep(10000);
        }
    }

    [self cleanupConnection:connection];
    libssh2_session_set_blocking(session.rawSession, 1);
}

- (void)stop {
    if (self.stopped) {
        return;
    }
    self.stopped = YES;

    if (self.acceptSource) {
        dispatch_source_cancel(self.acceptSource);
        self.acceptSource = nil;
    } else if (self.listenerSocket >= 0) {
        close(self.listenerSocket);
        self.listenerSocket = -1;
    }

    NSArray<SSHLocalPortForwardConnection *> *connections = nil;
    @synchronized (self.connections) {
        connections = [self.connections allObjects];
    }
    for (SSHLocalPortForwardConnection *connection in connections) {
        connection.stopped = YES;
        if (connection.localSocket >= 0) {
          shutdown(connection.localSocket, SHUT_RDWR);
          close(connection.localSocket);
          connection.localSocket = -1;
        }
        if (connection.channel != NULL) {
          libssh2_channel_send_eof(connection.channel);
          libssh2_channel_close(connection.channel);
          libssh2_channel_free(connection.channel);
          connection.channel = NULL;
        }
    }

    @synchronized (self.connections) {
        [self.connections removeAllObjects];
    }
}

@end
