#import <Foundation/Foundation.h>
#import "SSHClient.h"

@interface SSHLocalPortForward : NSObject

@property (nonatomic, readonly) NSString *tunnelId;
@property (nonatomic, readonly) NSString *localHost;
@property (nonatomic, readonly) NSInteger localPort;
@property (nonatomic, readonly) NSString *remoteHost;
@property (nonatomic, readonly) NSInteger remotePort;

- (instancetype)initWithClient:(SSHClient *)client
                    remoteHost:(NSString *)remoteHost
                    remotePort:(NSInteger)remotePort
                     localHost:(NSString *)localHost
                     localPort:(NSInteger)localPort;
- (BOOL)start:(NSError **)error;
- (void)stop;

@end
