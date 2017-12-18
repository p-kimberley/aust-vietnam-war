/**
 * @param {jQuery} resultTargetEl
 * @constructor
 * @class
 * @extends {BM.SearchSource.ES}
 */
BM.SearchSource.ES.Incident = function(resultTargetEl)
{
	BM.SearchSource.ES.call(this, 'Incidents', resultTargetEl, 'avw_contacts', 'contact', ['Fr_Units_Involved', 'Description_of_Incident']);
};

BM.SearchSource.ES.Incident.prototype = Object.create(BM.SearchSource.ES.prototype);
BM.SearchSource.ES.Incident.prototype.constructor = BM.SearchSource.ES.Incident;

BM.SearchSource.ES.Incident.prototype.generateResultHeader = function(data)
{
	var dtg = moment(data._source.DTG).format('DD MMM YYYY');
	return data._source.Fr_Units_Involved + ' (' + dtg + ')';
};

BM.SearchSource.ES.Incident.prototype.generateResultSubtext = function(data)
{
	return this.getHighlight(data);
};

BM.SearchSource.ES.Incident.prototype.handleResultSelected = function(data)
{
	var incidentID = data._id;
	if (incidentID)
	{
		var id = parseInt(incidentID);
		var layer = BM.LayerPanel.layerController.getLayer(BM.LayerType.contact.individual);
		var marker = layer.getMarkerByID(id);

		layer.selectMarker(marker);		// Selecting the marker will also display the marker context sidebar

		var location = data._source.Location;
		var coords = ol.proj.fromLonLat([location.lon, location.lat], 'EPSG:4326');

		BM.flyTo(coords, 12, 1000);
	}
};