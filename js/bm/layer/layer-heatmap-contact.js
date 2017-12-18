/**
 * Specialised heatmap type for contact data
 * @param {BM.LayerType} type
 * @param {string} title
 * @constructor
 * @extends {BM.Layer.Heatmap}
 */
BM.Layer.Heatmap.Contact = function(type, title)
{
	var self = this;
	this.dataFields = [
		{ name: 'Size of friendly force', value: 'Fr_Force_Present', selected: true },
		{ name: 'Friendly casualties', value: 'Total_Fr_Cas' },
		{ name: 'Size of enemy force', value: 'En_Force' },
		{ name: 'Enemy casualties', value: 'Total_En_Cas' }
	];

	BM.Layer.Heatmap.call(this, type, title, {
		heatmapField: new BM.LayerOption.Selectmenu('Data field', {
			options: this.dataFields,
			onChange: function(oldValue, newValue) {
				self.valueField = newValue;
				self.generate();
			}
		})
	});

	// Generate the heatmap based on the selected data field
	this.valueField = this.layerOptions.heatmapField.getValue();

	$('body').on('bm:contact-filter.changed', function() {
		if (self.isChecked())
			self.regenerate();
	});
};

BM.Layer.Heatmap.Contact.prototype = Object.create(BM.Layer.Heatmap.prototype);
BM.Layer.Heatmap.Contact.prototype.constructor = BM.Layer.Heatmap.Contact;

/**
 * Generates a heatmap using vector points
 * @param callback
 * @protected
 */
BM.Layer.Heatmap.Contact.prototype.generate = function(callback)
{
	var self = this;

	// Ensure a value field was selected by the subclass
	if (!this.valueField)
	{
		console.log('Warning: Heatmap type "' + this.type + '" has an unset value field');
		if (callback)
			callback();

		return;
	}

	// Remove the existing layer if it exists
	if (self.olLayer)
		BM.map.removeLayer(self.olLayer);

	var query = BM.FilterPanel.contactFilterController.toElasticSearchQuery();
	var points = new ol.Collection();
	var min, max, valueSpan;
	var currentIncident = 0;

	$.ajax({
		url: '/api/es/search/avw_contacts/contact?scroll=30s',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 1000,
			"_source": ['Location', this.valueField],
			"sort": [{
				"DTG": {
					"order": "asc"
				}
			}],
			"query": query,
			"aggs": {
				"stats": {
					"stats": {
						"field": this.valueField
					}
				}
			}
		})
	}).done(function processResults(response) {
		if (response.aggregations)
		{
			min = response.aggregations.stats.min;
			max = response.aggregations.stats.max;
			valueSpan = max - min;
		}

		$.each(response.hits.hits, function (i, item) {
			var fields = item._source;
			var feature = new ol.Feature({
				geometry: new ol.geom.Point(ol.proj.fromLonLat([fields.Location.lon, fields.Location.lat], 'EPSG:4326')),
				weight: fields[self.valueField]
			});

			feature.set('weight', valueSpan > 0 ? (fields[self.valueField] - min) / valueSpan : 0);
			points.push(feature);

			currentIncident++;
		});

		if (response.hits.total !== currentIncident)
		{
			$.ajax({
				url: "/api/es/scroll",
				method: "POST",
				dataType: 'json',
				contentType: 'application/json',
				data: JSON.stringify({
					"scroll": '30s',
					"scroll_id": response._scroll_id
				})
			}).then(function(response) {
				processResults(response);
			});
		}
		else
		{
			self.olLayer = new ol.layer.Heatmap({
				source: new ol.source.Vector({
					features: points
				}),
				gradient: self.gradient,
				blur: self.layerOptions.heatmapBlur.getValue(),
				radius: self.layerOptions.heatmapRadius.getValue()
			});

			BM.map.addLayer(self.olLayer);

			if (callback)
				return callback();
		}
	});
};