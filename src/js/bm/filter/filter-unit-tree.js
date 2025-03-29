/**
 * A filter allowing the user to select units from a hierarchical tree structure
 * @param {BM.FilterID} filterID
 * @param {string} label
 * @param {string} dataField
 * @param callback
 * @constructor
 * @extends {BM.Filter}
 */
BM.Filter.UnitTree = function(filterID, label, dataField, callback)
{
	BM.Filter.call(this, filterID, label, dataField);

	var self = this;
	this.defaultTipTitle = 'Search';
	this.defaultTipText = 'This box displays the units that will be included into the filter.';
	this.searchControl = $(document.createElement('input'))
		.addClass('map-filter-textbox')
		.attr('id', filterID)
		.attr('type', 'text')
		.attr('placeholder', 'Search')
		.on('keyup', function(event) {
			if (event.which === 27)
				self.searchControl.val('');

			self.filterControl.jstree(true).search(self.searchControl.val());
		})
		.appendTo(this.filterControlContainer);
	this.filterControl = $(document.createElement('div'))
		.addClass('map-filter-treeview')
		.on('changed.jstree', function(e, data) {
			self.values = data.selected;
		})
		.appendTo(this.filterControlContainer);

	this.values = [];

	// Load all distinct unit strings into the array on the client for use with the unit filter tooltip
	$.ajax({
		url: '/api/es/search/avw_units',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"aggs": {
				"units": {
					"terms": {
						"field": "Path.raw",
						"size": 999,
						"order": {
							"_term": "asc"
						}
					},
					"aggs": {
						"incidents": {
							"value_count": {
								"field": "Incidents.ID"
							}
						},
						"fields": {
							"top_hits": {
								"size": 1,
								"_source": {
									"include": ["Title", "ShortTypeName", "Parent"]
								}
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		// Parse unit list into a tree structure
		var rootNodes = [];
		var rootNode = undefined;
		var parentNode = undefined;

		var createNode = function(id, displayName, parentNode, incidents) {
			return {
				id: id.toString(),
				text: displayName + " <span class='item-count'>(" + incidents.toLocaleString() + ")</span>",
				displayName: displayName,
				parentNode: parentNode,
				incidents: incidents,
				children: []
			};
		};

		var updateNodeText = function(node, incidents) {
			node.text = node.displayName + " <span class='item-count'>(" + incidents.toLocaleString() + ")</span>";
		};

		$.each(data.aggregations.units.buckets, function(i, unit) {
			var fields = unit.fields.hits.hits[0]._source;
			var id = unit.fields.hits.hits[0]._id;
			var parent = fields.Parent;
			var incidents = unit.incidents.value;
			var nodeSeek = undefined;
			var displayName = fields.Title;

			if (fields.ShortTypeName)
			{
				if (displayName)
					displayName += (" " + fields.ShortTypeName);
				else
					displayName = fields.ShortTypeName;
			}

			if (!parent)
			{
				if (rootNode)
					rootNodes.push(rootNode);

				rootNode = createNode(id, displayName, undefined, incidents);
				parentNode = rootNode;
			}
			else if(parent == parentNode.id)
			{
				// Node is subordinate to the current parent node, so append it
				var newNode = createNode(id, displayName, parentNode, incidents);
				parentNode.children.push(newNode);

				// Increment incident count of all parent nodes
				nodeSeek = parentNode;
				while (nodeSeek)
				{
					nodeSeek.incidents += incidents;
					updateNodeText(nodeSeek, nodeSeek.incidents);

					nodeSeek = nodeSeek.parentNode;
				}

				parentNode = newNode;
			}
			else
			{
				nodeSeek = parentNode;
				var parentFound = false;

				// Scan recursively up the tree for this node's parent
				while(nodeSeek)
				{
					if (!parentFound)
					{
						// Check for a root node match
						if (parent == nodeSeek.id)
						{
							var newNode = createNode(id, displayName, nodeSeek, incidents);
							nodeSeek.children.push(newNode);
							nodeSeek.incidents += incidents;
							updateNodeText(nodeSeek, nodeSeek.incidents);
							parentNode = newNode;
							parentFound = true;
						}
						else
						{
							// Check this node's children for a match
							$.each(nodeSeek.children, function (i, childNode) {
								if (parent == childNode.id)
								{
									var newNode = createNode(id, displayName, childNode, incidents);
									childNode.children.push(newNode);
									childNode.incidents += incidents;
									updateNodeText(childNode, childNode.incidents);

									parentNode = newNode;
									parentFound = true;
									return false;
								}
							});
						}
					}
					else
					{
						nodeSeek.incidents += incidents;
						updateNodeText(nodeSeek, nodeSeek.incidents);
					}

					nodeSeek = nodeSeek.parentNode;
				}
			}
		});

		if (rootNode)
			rootNodes.push(rootNode);

		// Remove parent node references, as these cause recursion errors with jsTree
		var removeParentReference = function(node) {
			$.each(node.children, function(i, child) {
				child.parentNode = undefined;
				removeParentReference(child);
			});

			node.parentNode = undefined;
		};

		$.each(rootNodes, function(i, node) {
			removeParentReference(node);
		});

		self.filterControl.jstree({
			plugins: ["checkbox", "search", "changed"],
			core: {
				data: rootNodes,
				themes: {
					name: "default",
					icons: false,
					dots: false
				},
				expand_selected_onload: false
			},
			search: {
				show_only_matches: true,
				show_only_matches_children: true
			}
		});

		self.filterControl.on('ready.jstree', function() {
			if (callback)
				callback();
		});
	});
};

BM.Filter.UnitTree.prototype = Object.create(BM.Filter.prototype);
BM.Filter.UnitTree.prototype.constructor = BM.Filter.UnitTree;

BM.Filter.UnitTree.prototype.activateFilterControl = function()
{
	if (this.searchControl)
		this.searchControl.focus();
};

BM.Filter.UnitTree.prototype.update = function()
{
	if (this.filterControl)
	{
		if (this.values.length > 0)
			this.filterControl.jstree('select_node', this.values, true);
		else
			this.filterControl.jstree('deselect_all', true);
	}
};

BM.Filter.UnitTree.prototype.reset = function()
{
	this.values = [];
	this.update();
};

BM.Filter.UnitTree.prototype.toDataFilterString = function()
{
	//return "indexof(" + this.dataField + "," + encodeURIComponent("'" + this.values[0] + "'") + ") ge 0";
	return "";
};

BM.Filter.UnitTree.prototype.toElasticSearchFilter = function()
{
	return JSON.parse('{ "terms": { "' + this.dataField + '": [' + this.values.toString() + '] } }');
};

BM.Filter.UnitTree.prototype.serialiseState = function()
{
	return this.values.toString();
};

BM.Filter.UnitTree.prototype.parseState = function(serialisedState)
{
	if (serialisedState)
	{
		this.values = serialisedState.split(',');
		this.update();
	}
};