# Obsidian Canvas Link Optimizer Plugin

This is a lightweight Obsidian plugin designed to enhance the user experience with canvas link nodes. By default, link nodes in Obsidian canvas load the web page content as they come into view. The plugin modifies this behavior by displaying a preview thumbnail instead, which significantly reduces resource consumption. Users can still access the full web page by clicking on the thumbnail if they need more detailed information.

Here's the default behavior of link nodes in Obsidian:
![](doc/img/showcase-no-plugin.gif)

With the Canvas Link Optimizer Plugin enabled, it looks like this:
![](doc/img/showcase-with-plugin.gif)

This plugin does not modify your vault data. All thumbnails are cached locally in the `.obsidian/plugins/canvas-link-optimizer/data` directory, which can be safely cleared if necessary.

## Keep In Mind

To generate a page thumbnail, the plugin initially performs a standard page load. Thus, it won't immediately optimize pre-existing link nodes as well as newly created ones.

## Why Use This Plugin?

Link nodes provide convenient previews of linked content without having to open the link itself. However, the auto-loading feature comes with its drawbacks, including:

- **Performance Impact**: Auto-loading is akin to opening additional browser tabs, which can significantly increase CPU and RAM usage. This can lead to performance issues, particularly on less powerful devices.
- **Security Concerns**: Autoloading pages can inadvertently load malicious content, posing potential risks such as cryptocurrency mining or sandbox escape attempts.
- **Visual Distractions**: The auto-loading of links can create flickering and other visual disturbances that interrupt your workflow and focus.
