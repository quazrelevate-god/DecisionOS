import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)

        // IOS-2 (2026-09-30) — THE SWIPE BACK, which iOS did not have at all.
        //
        // MOBILE-2 gave Android a real back button: close the overlay, else go
        // to the previous screen, else confirm before leaving. All of it hangs
        // off @capacitor/app's `backButton` event, and that event is ANDROID
        // ONLY — iOS never fires it, so none of that work reached this
        // platform. Capacitor also never touches
        // allowsBackForwardNavigationGestures (grep @capacitor/ios: zero
        // hits), and WKWebView defaults it to false. So the edge swipe every
        // iPhone user reaches for did nothing whatsoever.
        //
        // Turning it on gives the same behaviour through the platform's own
        // gesture rather than a second implementation: the app drives its
        // navigation through history, and overlays push a marker entry of
        // their own (hooks/useBackDismiss), so a webview history-back closes
        // an open sheet first and only then leaves the screen — which is
        // exactly the order backAction() defines for Android.
        //
        // No exit confirmation here, and none wanted: iOS has no back-to-exit
        // to guard against. Swiping at the first entry simply does nothing,
        // which is what an iPhone does everywhere else.
        let bridgeViewController = CAPBridgeViewController()
        window?.rootViewController = bridgeViewController
        window?.makeKeyAndVisible()
        // The webView is built in viewDidLoad, so ask for the view first.
        bridgeViewController.loadViewIfNeeded()
        bridgeViewController.webView?.allowsBackForwardNavigationGestures = true

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
