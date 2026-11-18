// link-images: make every image (including images in figures) a link to its own
// file, so clicking it opens the full image in a new browser tab, where the
// browser's own click-to-zoom works. Images that are already links are left as is.

const linkImages = {
  name: 'link-images',
  stage: 'document',
  plugin: () => (tree) => {
    const walk = (node, inLink) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (child.type === 'image' && !inLink) {
          return { type: 'link', url: child.url, children: [child] };
        }
        walk(child, inLink || child.type === 'link');
        return child;
      });
    };
    walk(tree, false);
  },
};

export default { name: 'link-images', transforms: [linkImages] };
