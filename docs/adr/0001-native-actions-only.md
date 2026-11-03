# Remove tiles only through YouTube's native actions, never by hiding them

Shoo exists to teach YouTube's recommender what the user does not want, so every Removal is YouTube's own "Not interested" or "Don't recommend channel" menu action, exactly as if the user clicked it. Hiding a Tile with CSS would be easier and more robust against markup changes, but YouTube would never learn from it and the user would silently lose content. When a Native action fails, Shoo records the failure and leaves the Tile visible.

**Consequences**: Shoo is coupled to YouTube's menu markup. All selectors and menu-item matching live in one module with captured real-page fixtures, so a YouTube redesign is a one-module fix.
