DecisionOS app icon — built from the gold-hairline variant.

ios/        AppIcon-1024.png is the one Xcode needs (opaque, no alpha, square:
            iOS rounds the corners itself). The other sizes are there if your
            project uses a legacy asset catalogue. Contents.json included.

android/    adaptive-foreground-1024.png  (transparent) + adaptive-background-1024.png
            are the two layers of the adaptive icon. The mark sits inside the
            safe circle, so no mask crops it.
            play-store-512.png is the Play listing icon.
            ic_launcher-*.png are legacy mipmaps.

web/        icon-192 / icon-512 for the PWA manifest (safe for "maskable"),
            apple-touch-icon-180, favicon-32, favicon-16.

Sizes at 76px and below are drawn separately, with the D's fill and the gold
line lifted, because at that scale the original values dissolve into the black.
Everything else is the artwork untouched.

Background is #090908. Keep it if you ever redraw a size by hand.
