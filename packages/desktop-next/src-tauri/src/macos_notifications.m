#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

@interface PaseoNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation PaseoNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
  if (@available(macOS 11.0, *)) {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList);
  } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    completionHandler(UNNotificationPresentationOptionAlert);
#pragma clang diagnostic pop
  }
}
@end

static void paseo_ensure_notification_delegate(void) {
  static PaseoNotificationDelegate *delegate = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    delegate = [[PaseoNotificationDelegate alloc] init];
    [UNUserNotificationCenter currentNotificationCenter].delegate = delegate;
  });
}

int paseo_notification_authorization_status(void) {
  paseo_ensure_notification_delegate();

  __block NSInteger authorizationStatus = UNAuthorizationStatusNotDetermined;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  [[UNUserNotificationCenter currentNotificationCenter]
      getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        authorizationStatus = settings.authorizationStatus;
        dispatch_semaphore_signal(semaphore);
      }];
  dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);

  switch (authorizationStatus) {
  case UNAuthorizationStatusDenied:
    return 1;
  case UNAuthorizationStatusAuthorized:
  case UNAuthorizationStatusProvisional:
    return 2;
  case UNAuthorizationStatusNotDetermined:
  default:
    return 0;
  }
}

int paseo_notification_request_authorization(void) {
  paseo_ensure_notification_delegate();

  __block BOOL isGranted = NO;
  __block NSError *requestError = nil;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  UNAuthorizationOptions options =
      UNAuthorizationOptionAlert | UNAuthorizationOptionBadge | UNAuthorizationOptionSound;

  [[UNUserNotificationCenter currentNotificationCenter]
      requestAuthorizationWithOptions:options
                    completionHandler:^(BOOL granted, NSError *error) {
                      isGranted = granted;
                      requestError = error;
                      dispatch_semaphore_signal(semaphore);
                    }];
  dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);

  return isGranted && requestError == nil ? 2 : paseo_notification_authorization_status();
}

int paseo_notification_send(const char *title, const char *body) {
  paseo_ensure_notification_delegate();

  int status = paseo_notification_authorization_status();
  if (status == 0) {
    status = paseo_notification_request_authorization();
  }
  if (status != 2) {
    return 0;
  }

  NSString *notificationTitle =
      title != NULL ? [NSString stringWithUTF8String:title] : @"Paseo";
  NSString *notificationBody =
      body != NULL ? [NSString stringWithUTF8String:body] : @"";
  if (notificationTitle == nil || notificationTitle.length == 0) {
    notificationTitle = @"Paseo";
  }
  if (notificationBody == nil) {
    notificationBody = @"";
  }

  UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
  content.title = notificationTitle;
  content.body = notificationBody;
  if (@available(macOS 12.0, *)) {
    content.interruptionLevel = UNNotificationInterruptionLevelActive;
  }

  NSString *identifier =
      [NSString stringWithFormat:@"paseo-notification-%@", [NSUUID UUID].UUIDString];
  UNNotificationRequest *request =
      [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];

  __block BOOL didSchedule = NO;
  __block NSError *scheduleError = nil;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  [[UNUserNotificationCenter currentNotificationCenter]
      addNotificationRequest:request
       withCompletionHandler:^(NSError *error) {
         scheduleError = error;
         didSchedule = error == nil;
         dispatch_semaphore_signal(semaphore);
       }];
  dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);

  return didSchedule && scheduleError == nil ? 1 : 0;
}
