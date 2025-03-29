/**
 * @param {jQuery} resultTargetEl
 * @constructor
 * @class
 * @extends {BM.SearchSource.ES}
 */
BM.SearchSource.ES.Person = function(resultTargetEl)
{
	BM.SearchSource.ES.call(this, 'People', resultTargetEl, 'avw_nomroll', 'person', ['Last_Name', 'First_Name', 'Second_Name']);
};

BM.SearchSource.ES.Person.prototype = Object.create(BM.SearchSource.ES.prototype);
BM.SearchSource.ES.Person.prototype.constructor = BM.SearchSource.ES.Person;

BM.SearchSource.ES.Person.prototype.generateResultHeader = function(data)
{
	return this.getHighlight(data);
};

BM.SearchSource.ES.Person.prototype.generateResultSubtext = function(data)
{
	var dob = moment(data._source.Birth.Date).format('DD/MM/YYYY');
	var died = (data._source.Death.Date ? moment(data._source.Death.Date).format('DD/MM/YYYY') : null);
	var cause = (data._source.Death.Cause ? ' (' + data._source.Death.Cause + ')' : '');
	return 'Born: ' + (dob ? dob : 'Unknown') + (died ? '<br/>Died: ' + died : '') + cause;
};

/**
 * Retrieves the first highlight markup string from the ES response
 * @param {{}} data
 */
BM.SearchSource.ES.Person.prototype.getHighlight = function(data)
{
	var lastName = data.highlight['Last_Name'];
	var firstName = data.highlight['First_Name'];
	var secondName = data.highlight['Second_Name'];
	return (lastName ? lastName : data._source.Last_Name) + ', ' + (firstName ? firstName : data._source.First_Name) + ' ' + (secondName ? secondName : data._source.Second_Name || '');
};

BM.SearchSource.ES.Person.prototype.handleResultSelected = function(data)
{

};